import { processAcquisitionRewards } from "../lib/acquisitionRewards";
/**
 * P4P Payroll Engine — Service-level percentage adjustments & customer sell-price material stripping.
 *
 * Formula:
 *   materialSellAmount = SUM(jobParts[].total)        ← customer sell-price snapshot per part
 *   netLaborRevenue  = jobTotalAmount - materialSellAmount
 *   p4pPct           = blueprint.p4pPercentage ?? service.p4pPercentage ?? tenant.p4pMasterPercentage
 *   p4pPool          = MAX(0, netLaborRevenue) × p4pPct / 100
 *
 * Multi-tech split (based on sub_timer contribution):
 *   techContribution = techSubTimerSeconds / totalJobSubTimerSeconds
 *   techEarnings     = p4pPool × techContribution
 */

import { Router, type IRouter } from "express";
import { db, jobsTable, blueprintsTable, tenantsTable, subTimersTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { subDays } from "date-fns";
import { zonedDayBounds } from "./timeTracking";
import { payrollRouter } from "./payroll";
import { p4pDamageRouter } from "./p4pDamage";
import { calculateDamagePay } from "../lib/p4pDamage";

const router: IRouter = Router();
router.use(payrollRouter);
router.use(p4pDamageRouter);
export type PayrollDb = Pick<typeof db, "select" | "execute">;
export type PayrollRange = { rangeStart: Date; rangeEnd: Date };

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate the P4P-eligible labor amount from the amount charged to the
 * customer. `materialSellAmount` is the persisted sum of `job_parts[].total`,
 * not the inventory item's acquisition cost and not a value to mark up again.
 */
export function calculateP4pAmounts(
  jobTotalAmount: number,
  materialSellAmount: number,
  p4pPercentage: number,
): { netLaborRevenue: number; p4pPool: number } {
  const netLaborRevenue = Math.max(0, jobTotalAmount - materialSellAmount);
  return {
    netLaborRevenue,
    p4pPool: netLaborRevenue * p4pPercentage / 100,
  };
}

function getPeriodRange(period: string, timezone: string): { rangeStart: Date; rangeEnd: Date } {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let from = day;
  let through = day;
  switch (period) {
    case "today":
      break;
    case "week": {
      const monday = new Date(`${day}T12:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      from = monday.toISOString().slice(0, 10);
      monday.setUTCDate(monday.getUTCDate() + 6);
      through = monday.toISOString().slice(0, 10);
      break;
    }
    case "month":
      from = day.slice(0, 7) + "-01";
      through = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
      break;
    case "30d":
    default:
      return { rangeStart: subDays(now, 30), rangeEnd: now };
  }
  return { rangeStart: zonedDayBounds(from, timezone)!.start, rangeEnd: new Date(+zonedDayBounds(through, timezone)!.end - 1) };
}

async function requestRange(query: Record<string, unknown>, tenantId: number): Promise<PayrollRange> {
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const timezone = tenant?.timezone ?? "UTC";
  if (query.dateFrom || query.dateTo) {
    const from = String(query.dateFrom);
    const to = String(query.dateTo);
    const rangeStart = new Date(`${from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${to}T23:59:59.999Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || !Number.isFinite(+rangeStart) || !Number.isFinite(+rangeEnd) || rangeStart > rangeEnd
      || rangeStart.toISOString().slice(0, 10) !== from || rangeEnd.toISOString().slice(0, 10) !== to) {
      throw Object.assign(new Error("Invalid payroll date range"), { status: 400 });
    }
    return { rangeStart: zonedDayBounds(from, timezone)!.start, rangeEnd: new Date(+zonedDayBounds(to, timezone)!.end - 1) };
  }
  return getPeriodRange(String(query.period ?? "30d"), timezone);
}

// ── role helper ──────────────────────────────────────────────────────────────
async function getCallerRole(tenantId: number, userId: number): Promise<string> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return u?.role ?? "technician";
}

const MANAGER_ROLES = new Set(["company_owner", "office_manager", "department_manager", "crew_manager"]);

// ── GET /p4p/jobs — per-job breakdown with material deduction + multi-tech splits ──
router.get("/p4p/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerUserId = getUserId(req);
  const callerRole = await getCallerRole(tenantId, callerUserId);
  const isTech = !MANAGER_ROLES.has(callerRole);

  // Technicians may only view their own data; managers can filter by any userId or see all.
  const { period = "30d", userId: rawUserId } = req.query as Record<string, string>;
  const userId = isTech ? String(callerUserId) : rawUserId;
  const range = await requestRange(req.query, tenantId);
  res.json(await calculatePayrollJobs(db, tenantId, range, userId));
});

export async function calculatePayrollJobs(db: PayrollDb, tenantId: number, { rangeStart, rangeEnd }: PayrollRange, userId?: string) {

  // Tenant global P4P rate
  const [tenant] = await db
    .select({ p4pMasterPercentage: tenantsTable.p4pMasterPercentage })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const globalPct = tenant?.p4pMasterPercentage ?? 0;

  // Completed jobs in range. `total` is the customer sell-price snapshot
  // recorded on each job part; do not join inventory pricing or apply markup.
  const jobRows = await db.execute(sql`
    SELECT
      j.id,
      j.title,
      j.total_amount,
      j.blueprint_id,
      j.assignee_id,
      j.crew_id,
      j.completed_at,
      COALESCE((
        SELECT SUM((part->>'total')::numeric)
        FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part
      ), 0) AS material_sell_amount,
      COALESCE(
        payroll_rate_at(j.tenant_id, 'blueprint', j.blueprint_id, j.completed_at),
        payroll_rate_at(j.tenant_id, 'service', j.service_id, j.completed_at)
      ) AS blueprint_p4p_pct,
      payroll_rate_at(j.tenant_id, 'global', j.tenant_id, j.completed_at) AS global_p4p_pct,
      b.name AS blueprint_name,
      c.name AS customer_name
    FROM jobs j
    LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
    LEFT JOIN services s ON s.id = j.service_id AND s.tenant_id = j.tenant_id
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId}
      AND j.status = 'completed'
      AND j.completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND j.completed_at <= ${rangeEnd.toISOString()}::timestamptz
    ORDER BY j.completed_at DESC, j.id DESC
  `);

  type JobRow = {
    id: number; title: string; total_amount: string; blueprint_id: number | null;
    assignee_id: number | null; crew_id: number | null; completed_at: string;
    material_sell_amount: string; blueprint_p4p_pct: number | null; global_p4p_pct: number | null; blueprint_name: string | null;
    customer_name: string | null;
  };
  const jobs = jobRows.rows as JobRow[];

  if (jobs.length === 0) return [];

  // Sub-timer contribution per (jobId, userId) — for splits
  const jobIds = jobs.map(j => Number(j.id));
  const subTimerRows = await db.execute(sql`
    SELECT
      job_id,
      user_id,
      SUM(
        CASE WHEN is_active THEN EXTRACT(EPOCH FROM (NOW() - started_at))
             ELSE elapsed_seconds
        END
      ) AS seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id = ANY(${sql.raw(`ARRAY[${jobIds.join(",")}]::int[]`)})
    GROUP BY job_id, user_id
    ORDER BY job_id, user_id
  `);

  type TimerRow = { job_id: number; user_id: number; seconds: string };
  const timerRows = subTimerRows.rows as TimerRow[];

  // Build map: jobId → { userId → seconds }
  const timerMap = new Map<number, Map<number, number>>();
  for (const r of timerRows) {
    const jid = Number(r.job_id);
    const uid = Number(r.user_id);
    if (!timerMap.has(jid)) timerMap.set(jid, new Map());
    timerMap.get(jid)!.set(uid, Number(r.seconds ?? 0));
  }

  // User names
  const userIds = Array.from(new Set([...timerRows.map(r => Number(r.user_id)), ...jobs.flatMap(j => j.assignee_id == null ? [] : [Number(j.assignee_id)])]));
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(and(inArray(usersTable.id, userIds), eq(usersTable.tenantId, tenantId)))
    : [];
  const userMap = new Map(users.map(u => [u.id, u.name]));

  // Build result
  const result = jobs.map(j => {
    const totalAmount = Number(j.total_amount ?? 0);
    const materialCost = Number(j.material_sell_amount ?? 0);
    const p4pPct = Number(j.blueprint_p4p_pct ?? j.global_p4p_pct ?? 0);
    const { netLaborRevenue, p4pPool: unroundedP4pPool } = calculateP4pAmounts(totalAmount, materialCost, p4pPct);
    const p4pPool = Math.round(unroundedP4pPool * 100) / 100;

    const jobTimers = timerMap.get(Number(j.id)) ?? new Map<number, number>();
    const totalSeconds = Array.from(jobTimers.values()).reduce((s, v) => s + v, 0);

    // Equal split when all timers are zero (avoids each participant getting 100%)
    const equalShare = jobTimers.size > 0 ? 1 / jobTimers.size : 1;
    const splits = Array.from(jobTimers.entries()).map(([uid, secs]) => {
      const contributionPct = totalSeconds > 0 ? secs / totalSeconds : equalShare;
      const earnings = Math.round(p4pPool * contributionPct * 100) / 100;
      return {
        userId: uid,
        name: userMap.get(uid) ?? `User ${uid}`,
        techSeconds: Math.round(secs),
        totalSeconds: Math.round(totalSeconds),
        contributionPct: Math.round(contributionPct * 1000) / 10,
        earnings,
      };
    });

    // If no sub-timers, assign to assigneeId with 100%
    const effectiveSplits = splits.length > 0 ? splits : (
      j.assignee_id != null ? [{
        userId: Number(j.assignee_id),
        name: userMap.get(Number(j.assignee_id)) ?? `User ${j.assignee_id}`,
        techSeconds: 0,
        totalSeconds: 0,
        contributionPct: 100,
        earnings: p4pPool,
      }] : []
    );

    return {
      jobId: Number(j.id),
      jobTitle: j.title,
      customerName: j.customer_name ?? null,
      blueprintName: j.blueprint_name ?? null,
      completedAt: new Date(j.completed_at).toISOString(),
      totalAmount,
      materialCost: Math.round(materialCost * 100) / 100,
      netLaborRevenue: Math.round(netLaborRevenue * 100) / 100,
      p4pPct,
      p4pPool,
      splits: effectiveSplits,
      usingGlobalRate: j.blueprint_p4p_pct == null,
    };
  }).filter(j => {
    // If userId filter set, only include jobs where this user has a split
    if (userId) {
      return j.splits.some(s => s.userId === parseInt(userId, 10));
    }
    return true;
  });

  return result;
}

// ── GET /p4p/summary — per-technician totals for the period ──────────────────
router.get("/p4p/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerUserId = getUserId(req);
  const callerRole = await getCallerRole(tenantId, callerUserId);
  const isTech = !MANAGER_ROLES.has(callerRole);

  // Employees need the same server-calculated net P4P and hourly protection as
  // payroll administrators. Non-managers may receive only their own row.

  const { period = "30d" } = req.query as Record<string, string>;

  // Reuse jobs endpoint logic via a sub-call is messy; re-derive here for clarity.
  const range = await requestRange(req.query, tenantId);
  await processAcquisitionRewards(tenantId);
  const summary = await calculatePayrollSummary(db, tenantId, range, period);
  res.json(isTech ? { ...summary, technicians: summary.technicians.filter(t => t.userId === callerUserId) } : summary);
});

export async function calculatePayrollSummary(db: PayrollDb, tenantId: number, { rangeStart, rangeEnd }: PayrollRange, period = "custom") {

  const [tenant] = await db
    .select({ p4pMasterPercentage: tenantsTable.p4pMasterPercentage })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const globalPct = tenant?.p4pMasterPercentage ?? 0;

  const jobRows = await db.execute(sql`
    SELECT
      j.id,
      j.total_amount,
      j.assignee_id,
      COALESCE((
        SELECT SUM((part->>'total')::numeric)
        FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part
      ), 0) AS material_sell_amount,
      COALESCE(
        payroll_rate_at(j.tenant_id, 'blueprint', j.blueprint_id, j.completed_at),
        payroll_rate_at(j.tenant_id, 'service', j.service_id, j.completed_at),
        payroll_rate_at(j.tenant_id, 'global', j.tenant_id, j.completed_at), 0
      ) AS blueprint_p4p_pct
    FROM jobs j
    LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
    LEFT JOIN services s ON s.id = j.service_id AND s.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId}
      AND j.status = 'completed'
      AND j.completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND j.completed_at <= ${rangeEnd.toISOString()}::timestamptz
  `);

  type SumJobRow = { id: number; total_amount: string; assignee_id: number | null; material_sell_amount: string; blueprint_p4p_pct: number | null };
  const jobs = jobRows.rows as SumJobRow[];

  const jobIds = jobs.map(j => Number(j.id));
  const subTimerRows = await db.execute(sql`
    SELECT job_id, user_id,
      SUM(CASE WHEN is_active THEN EXTRACT(EPOCH FROM (NOW() - started_at)) ELSE elapsed_seconds END) AS seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id = ANY(${sql.raw(`ARRAY[${jobIds.join(",")}]::int[]`)})
    GROUP BY job_id, user_id
    ORDER BY job_id, user_id
  `);

  type TimerRow2 = { job_id: number; user_id: number; seconds: string };
  const timerRows = subTimerRows.rows as TimerRow2[];

  const timerMap = new Map<number, Map<number, number>>();
  for (const r of timerRows) {
    const jid = Number(r.job_id);
    const uid = Number(r.user_id);
    if (!timerMap.has(jid)) timerMap.set(jid, new Map());
    timerMap.get(jid)!.set(uid, Number(r.seconds ?? 0));
  }

  // Aggregate per-user
  const userEarnings = new Map<number, { p4pEarnings: number; jobCount: number; totalRevenue: number; totalMaterialCost: number; netLaborRevenue: number }>();

  for (const j of jobs) {
    const totalAmount = Number(j.total_amount ?? 0);
    const materialCost = Number(j.material_sell_amount ?? 0);
    const p4pPct = j.blueprint_p4p_pct != null ? Number(j.blueprint_p4p_pct) : globalPct;
    const { netLaborRevenue, p4pPool: rawPool } = calculateP4pAmounts(totalAmount, materialCost, p4pPct);
    const p4pPool = Math.round(rawPool * 100) / 100;

    const jobTimers = timerMap.get(Number(j.id)) ?? new Map<number, number>();
    const totalSeconds = Array.from(jobTimers.values()).reduce((s, v) => s + v, 0);

    const addEarnings = (uid: number, earnings: number) => {
      const prev = userEarnings.get(uid) ?? { p4pEarnings: 0, jobCount: 0, totalRevenue: 0, totalMaterialCost: 0, netLaborRevenue: 0 };
      userEarnings.set(uid, {
        p4pEarnings: prev.p4pEarnings + Math.round(earnings * 100) / 100,
        jobCount: prev.jobCount + 1,
        totalRevenue: prev.totalRevenue + totalAmount,
        totalMaterialCost: prev.totalMaterialCost + materialCost,
        netLaborRevenue: prev.netLaborRevenue + netLaborRevenue,
      });
    };

    if (jobTimers.size > 0) {
      // Equal split when all timers are zero — avoids each participant getting 100%
      const equalShare = 1 / jobTimers.size;
      for (const [uid, secs] of jobTimers.entries()) {
        const contribution = totalSeconds > 0 ? secs / totalSeconds : equalShare;
        addEarnings(uid, p4pPool * contribution);
      }
    } else if (j.assignee_id != null) {
      addEarnings(Number(j.assignee_id), p4pPool);
    }
  }

  const [eligibility] = await db.select({ ownersSchedulable: tenantsTable.ownersSchedulable }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const allUsers = await db.select().from(usersTable).where(eq(usersTable.tenantId, tenantId));
  // Split each closed clock entry at every effective-rate boundary. An average
  // or the employee's current rate would misprice a raise in the middle of a shift.
  const clockRows = await db.execute(sql`
    WITH history AS (
      SELECT id, source_id, value, effective_at FROM payroll_rates
      WHERE tenant_id=${tenantId} AND source='hourly'
      UNION ALL
      SELECT -1, id, NULL::real, '1970-01-01'::timestamptz FROM users WHERE tenant_id=${tenantId}
    ), versions AS (
      SELECT source_id AS user_id, value, effective_at,
        LEAD(effective_at, 1, 'infinity'::timestamptz)
          OVER (PARTITION BY source_id ORDER BY effective_at, id) AS until
      FROM history
    ), segments AS (
      SELECT t.user_id, v.value AS rate,
        GREATEST(COALESCE(t.adjusted_clocked_in_at,t.clocked_in_at), ${rangeStart.toISOString()}::timestamptz, v.effective_at) AS starts,
        LEAST(COALESCE(t.adjusted_clocked_out_at,t.clocked_out_at), ${rangeEnd.toISOString()}::timestamptz, v.until) AS ends
      FROM time_entries t JOIN versions v ON v.user_id=t.user_id
      WHERE t.tenant_id=${tenantId} AND t.is_master_clock=true
        AND COALESCE(t.adjusted_clocked_out_at,t.clocked_out_at) IS NOT NULL
    )
    SELECT user_id, rate, SUM(EXTRACT(EPOCH FROM (ends-starts)))/3600 AS hours
    FROM segments WHERE ends > starts GROUP BY user_id, rate
    ORDER BY user_id, rate NULLS FIRST
  `);
  const segmentsByUser = new Map<number, { rate: number | null; hours: number }[]>();
  for (const row of clockRows.rows) {
    const id = Number(row.user_id);
    segmentsByUser.set(id, [...(segmentsByUser.get(id) ?? []), { rate: row.rate == null ? null : Number(row.rate), hours: Number(row.hours) }]);
  }
  const endRates = await db.execute(sql`
    SELECT id, payroll_rate_at(tenant_id, 'hourly', id, ${rangeEnd.toISOString()}::timestamptz) AS rate
    FROM users WHERE tenant_id=${tenantId}
  `);
  const rateByUser = new Map(endRates.rows.map(r => [Number(r.id), r.rate == null ? null : Number(r.rate)]));
  const bonuses = await db.execute(sql`SELECT recipient_user_id,SUM(amount)::float AS amount FROM acquisition_rewards
    WHERE tenant_id=${tenantId} AND kind='employee_bonus' AND payroll_at >= ${rangeStart.toISOString()}::timestamptz
    AND payroll_at <= ${rangeEnd.toISOString()}::timestamptz GROUP BY recipient_user_id`);
  const acquisitionBonusMap = new Map(bonuses.rows.map(row => [Number(row.recipient_user_id), Number(row.amount)]));
  const damageRows = await db.execute(sql`
    SELECT r.id, r.allocations FROM p4p_damage_reports r
    JOIN tenants t ON t.id=r.tenant_id
    WHERE r.tenant_id=${tenantId} AND r.status='approved'
      AND r.payroll_date BETWEEN
        (${rangeStart.toISOString()}::timestamptz AT TIME ZONE COALESCE(t.timezone,'UTC'))::date
        AND (${rangeEnd.toISOString()}::timestamptz AT TIME ZONE COALESCE(t.timezone,'UTC'))::date
    ORDER BY r.id
  `);
  const damages = new Map<number, { amount: number; reportIds: number[] }>();
  for (const row of damageRows.rows) {
    for (const a of row.allocations as Array<{ userId: number; amount: number }>) {
      const previous = damages.get(a.userId) ?? { amount: 0, reportIds: [] };
      previous.amount += Math.round(a.amount * 100) / 100;
      previous.reportIds.push(Number(row.id));
      damages.set(a.userId, previous);
    }
  }
  const users = allUsers.filter(u => u.role === "technician" || u.role === "crew_manager"
    || (u.role === "company_owner" && (eligibility?.ownersSchedulable || userEarnings.has(u.id) || segmentsByUser.has(u.id)))
    // Scheduling controls future assignment, not whether already-recorded work gets paid.
    || acquisitionBonusMap.has(u.id) || damages.has(u.id));

  const technicians = users.map(u => {
    const stats = userEarnings.get(u.id) ?? { p4pEarnings: 0, jobCount: 0, totalRevenue: 0, totalMaterialCost: 0, netLaborRevenue: 0 };
    const rateSegments = segmentsByUser.get(u.id) ?? [];
    const clockHours = rateSegments.reduce((sum, s) => sum + s.hours, 0);
    const basePay = rateSegments.some(s => s.rate == null) || (!rateSegments.length && rateByUser.get(u.id) == null)
      ? null : rateSegments.reduce((sum, s) => sum + s.hours * (s.rate ?? 0), 0);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      baseHourlyRate: rateByUser.get(u.id) ?? null,
      rateSegments,
      clockHours: Math.round(clockHours * 100) / 100,
      basePay: basePay == null ? null : Math.round(basePay * 100) / 100,
      acquisitionBonusPay: acquisitionBonusMap.get(u.id) ?? 0,
      ...calculateDamagePay(stats.p4pEarnings, basePay, damages.get(u.id)?.amount ?? 0, acquisitionBonusMap.get(u.id) ?? 0),
      damageReportIds: damages.get(u.id)?.reportIds ?? [],
      jobCount: stats.jobCount,
      totalRevenue: Math.round(stats.totalRevenue * 100) / 100,
      totalMaterialCost: Math.round(stats.totalMaterialCost * 100) / 100,
      netLaborRevenue: Math.round(stats.netLaborRevenue * 100) / 100,
    };
  }).sort((a, b) => b.p4pEarnings - a.p4pEarnings || a.userId - b.userId);

  return {
    period,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    globalP4pPct: globalPct,
    technicians,
  };
}

export default router;
