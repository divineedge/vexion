/**
 * P4P Payroll Engine — Service-level percentage adjustments & material cost stripping.
 *
 * Formula:
 *   materialCost     = SUM(jobParts[].total)          ← marked-up sell price per part
 *   netLaborRevenue  = jobTotalAmount - materialCost
 *   p4pPct           = blueprint.p4pPercentage ?? tenant.p4pMasterPercentage
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
import { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays } from "date-fns";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function getPeriodRange(period: string): { rangeStart: Date; rangeEnd: Date } {
  const now = new Date();
  switch (period) {
    case "today":
      return { rangeStart: startOfDay(now), rangeEnd: endOfDay(now) };
    case "week":
      return { rangeStart: startOfWeek(now, { weekStartsOn: 1 }), rangeEnd: endOfWeek(now, { weekStartsOn: 1 }) };
    case "month":
      return {
        rangeStart: new Date(now.getFullYear(), now.getMonth(), 1),
        rangeEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
      };
    case "30d":
    default:
      return { rangeStart: subDays(now, 30), rangeEnd: now };
  }
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
  const { rangeStart, rangeEnd } = getPeriodRange(period);

  // Tenant global P4P rate
  const [tenant] = await db
    .select({ p4pMasterPercentage: tenantsTable.p4pMasterPercentage })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const globalPct = tenant?.p4pMasterPercentage ?? 0;

  // Completed jobs in range with JSONB material cost calculation
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
      ), 0) AS material_cost,
      b.p4p_percentage AS blueprint_p4p_pct,
      b.name AS blueprint_name,
      c.name AS customer_name
    FROM jobs j
    LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId}
      AND j.status = 'completed'
      AND j.completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND j.completed_at <= ${rangeEnd.toISOString()}::timestamptz
    ORDER BY j.completed_at DESC
  `);

  type JobRow = {
    id: number; title: string; total_amount: string; blueprint_id: number | null;
    assignee_id: number | null; crew_id: number | null; completed_at: string;
    material_cost: string; blueprint_p4p_pct: number | null; blueprint_name: string | null;
    customer_name: string | null;
  };
  const jobs = jobRows.rows as JobRow[];

  if (jobs.length === 0) { res.json([]); return; }

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
  const userIds = Array.from(new Set(timerRows.map(r => Number(r.user_id))));
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(and(inArray(usersTable.id, userIds), eq(usersTable.tenantId, tenantId)))
    : [];
  const userMap = new Map(users.map(u => [u.id, u.name]));

  // Build result
  const result = jobs.map(j => {
    const totalAmount = Number(j.total_amount ?? 0);
    const materialCost = Number(j.material_cost ?? 0);
    const netLaborRevenue = Math.max(0, totalAmount - materialCost);
    const p4pPct = j.blueprint_p4p_pct != null ? Number(j.blueprint_p4p_pct) : globalPct;
    const p4pPool = Math.round((netLaborRevenue * p4pPct / 100) * 100) / 100;

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
      completedAt: j.completed_at,
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

  res.json(result);
});

// ── GET /p4p/summary — per-technician totals for the period ──────────────────
router.get("/p4p/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerUserId = getUserId(req);
  const callerRole = await getCallerRole(tenantId, callerUserId);
  const isTech = !MANAGER_ROLES.has(callerRole);

  // Technicians may only fetch their own summary (redirect to /p4p/jobs with userId filter)
  // The summary endpoint returns all-tech aggregates — block technicians at the source.
  if (isTech) { res.status(403).json({ error: "Access restricted to manager roles" }); return; }

  const { period = "30d" } = req.query as Record<string, string>;

  // Reuse jobs endpoint logic via a sub-call is messy; re-derive here for clarity.
  const { rangeStart, rangeEnd } = getPeriodRange(period);

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
      ), 0) AS material_cost,
      b.p4p_percentage AS blueprint_p4p_pct
    FROM jobs j
    LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId}
      AND j.status = 'completed'
      AND j.completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND j.completed_at <= ${rangeEnd.toISOString()}::timestamptz
  `);

  type SumJobRow = { id: number; total_amount: string; assignee_id: number | null; material_cost: string; blueprint_p4p_pct: number | null };
  const jobs = jobRows.rows as SumJobRow[];

  if (jobs.length === 0) {
    // Still return all techs with 0 earnings
    const techs = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId)));
    res.json({
      period, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), globalP4pPct: globalPct,
      technicians: techs.filter(t => t.role === "technician" || t.role === "crew_manager").map(t => ({ userId: t.id, name: t.name, p4pEarnings: 0, jobCount: 0, totalRevenue: 0, totalMaterialCost: 0, netLaborRevenue: 0 })),
    });
    return;
  }

  const jobIds = jobs.map(j => Number(j.id));
  const subTimerRows = await db.execute(sql`
    SELECT job_id, user_id,
      SUM(CASE WHEN is_active THEN EXTRACT(EPOCH FROM (NOW() - started_at)) ELSE elapsed_seconds END) AS seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id = ANY(${sql.raw(`ARRAY[${jobIds.join(",")}]::int[]`)})
    GROUP BY job_id, user_id
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
    const materialCost = Number(j.material_cost ?? 0);
    const netLaborRevenue = Math.max(0, totalAmount - materialCost);
    const p4pPct = j.blueprint_p4p_pct != null ? Number(j.blueprint_p4p_pct) : globalPct;
    const p4pPool = netLaborRevenue * p4pPct / 100;

    const jobTimers = timerMap.get(Number(j.id)) ?? new Map<number, number>();
    const totalSeconds = Array.from(jobTimers.values()).reduce((s, v) => s + v, 0);

    const addEarnings = (uid: number, earnings: number) => {
      const prev = userEarnings.get(uid) ?? { p4pEarnings: 0, jobCount: 0, totalRevenue: 0, totalMaterialCost: 0, netLaborRevenue: 0 };
      userEarnings.set(uid, {
        p4pEarnings: prev.p4pEarnings + earnings,
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

  const userIds = Array.from(userEarnings.keys());
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable).where(and(inArray(usersTable.id, userIds), eq(usersTable.tenantId, tenantId)))
    : [];

  const technicians = users.map(u => {
    const stats = userEarnings.get(u.id) ?? { p4pEarnings: 0, jobCount: 0, totalRevenue: 0, totalMaterialCost: 0, netLaborRevenue: 0 };
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      p4pEarnings: Math.round(stats.p4pEarnings * 100) / 100,
      jobCount: stats.jobCount,
      totalRevenue: Math.round(stats.totalRevenue * 100) / 100,
      totalMaterialCost: Math.round(stats.totalMaterialCost * 100) / 100,
      netLaborRevenue: Math.round(stats.netLaborRevenue * 100) / 100,
    };
  }).sort((a, b) => b.p4pEarnings - a.p4pEarnings);

  res.json({
    period,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    globalP4pPct: globalPct,
    technicians,
  });
});

export default router;
