/**
 * P4P Labor Efficiency Engine — Mike Andes methodology.
 *
 * Two efficiency metrics:
 *  1. Clock Efficiency  = SUM(job sub-timer seconds) ÷ (total master-clock minutes × 60) × 100
 *     "What % of the day was actually on jobs?" Un-assigned gaps & travel lower this score.
 *  2. Budget Efficiency = SUM(estimated_duration on completed jobs) ÷ SUM(actual job seconds / 60) × 100
 *     "Did they beat the time budget?" >100% = finished faster than budgeted (good).
 *
 * Callbacks = Mike Andes "yellow slips".  They appear on every view (employee, crew, service).
 */

import { Router, type IRouter } from "express";
import { db, timeEntriesTable, subTimersTable, usersTable, crewsTable, tenantsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { getCallbackRatioStats } from "../lib/callbackRatio";
import { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays } from "date-fns";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/** Budget efficiency: budget_minutes / actual_job_minutes × 100, capped at 300% */
function budgetEff(budgetMinutes: number, actualJobSeconds: number): number | null {
  const actualMinutes = actualJobSeconds / 60;
  if (budgetMinutes <= 0 || actualMinutes <= 0) return null;
  return Math.min(Math.round((budgetMinutes / actualMinutes) * 100), 300);
}

// ── GET /efficiency — company-wide + per-technician summary ─────────────────
router.get("/efficiency", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { period = "today", startDate, endDate } = req.query as Record<string, string>;

  let rangeStart: Date, rangeEnd: Date;
  if (startDate && endDate) {
    rangeStart = new Date(startDate + "T00:00:00");
    rangeEnd = new Date(endDate + "T23:59:59");
  } else {
    ({ rangeStart, rangeEnd } = getPeriodRange(period));
  }

  // Master clock minutes per user
  const clockRows = await db
    .select({
      userId: timeEntriesTable.userId,
      totalClockMinutes: sql<number>`COALESCE(SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
        COALESCE(${timeEntriesTable.adjustedClockedOutAt}, ${timeEntriesTable.clockedOutAt})
        - COALESCE(${timeEntriesTable.adjustedClockedInAt}, ${timeEntriesTable.clockedInAt})
      )) / 60))), 0)::int`,
    })
    .from(timeEntriesTable)
    .where(and(
      eq(timeEntriesTable.tenantId, tenantId),
      eq(timeEntriesTable.isMasterClock, true),
      sql`COALESCE(${timeEntriesTable.adjustedClockedInAt}, ${timeEntriesTable.clockedInAt}) >= ${rangeStart}`,
      sql`COALESCE(${timeEntriesTable.adjustedClockedInAt}, ${timeEntriesTable.clockedInAt}) <= ${rangeEnd}`,
      sql`${timeEntriesTable.clockedOutAt} IS NOT NULL`,
    ))
    .groupBy(timeEntriesTable.userId);

  // Job sub-timer seconds per user (includes live running timers)
  const subTimerRows = await db.execute(sql`
    SELECT
      user_id,
      SUM(
        CASE WHEN is_active THEN EXTRACT(EPOCH FROM (NOW() - started_at)) ELSE elapsed_seconds END
      ) AS job_seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id IS NOT NULL
      AND started_at >= ${rangeStart.toISOString()}::timestamptz
      AND started_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY user_id
  `);

  // Budget minutes per assignee (sum of estimatedDuration on completed jobs)
  const budgetRows = await db.execute(sql`
    SELECT
      assignee_id AS user_id,
      COALESCE(SUM(estimated_duration), 0) AS budget_minutes,
      COUNT(*)::int AS budget_job_count
    FROM jobs
    WHERE tenant_id = ${tenantId}
      AND status = 'completed'
      AND completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND completed_at <= ${rangeEnd.toISOString()}::timestamptz
      AND assignee_id IS NOT NULL
      AND estimated_duration IS NOT NULL
    GROUP BY assignee_id
  `);

  // Callback ratio stats (shared source so both pages match)
  const callbackStats = await getCallbackRatioStats(tenantId, { rangeStart, rangeEnd });
  const callbackStatMap = new Map(callbackStats.technicians.map(t => [t.userId, t]));

  // User names + roles
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.tenantId, tenantId));

  // Build maps
  const subTimerMap = new Map<number, number>();
  for (const row of subTimerRows.rows as { user_id: number; job_seconds: number }[]) {
    subTimerMap.set(Number(row.user_id), Number(row.job_seconds ?? 0));
  }
  const clockMap = new Map<number, number>();
  for (const row of clockRows) clockMap.set(row.userId, row.totalClockMinutes ?? 0);
  const budgetMap = new Map<number, { budgetMinutes: number; budgetJobCount: number }>();
  for (const row of budgetRows.rows as { user_id: number; budget_minutes: string; budget_job_count: number }[]) {
    budgetMap.set(Number(row.user_id), {
      budgetMinutes: Number(row.budget_minutes ?? 0),
      budgetJobCount: Number(row.budget_job_count ?? 0),
    });
  }

  const [tenant] = await db.select({ ownersSchedulable: tenantsTable.ownersSchedulable }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const ownerEligible = tenant?.ownersSchedulable === true;
  const technicianMetrics = users
    .filter(u => u.role === "technician" || u.role === "crew_manager" || (u.role === "company_owner" && ownerEligible))
    .map(u => {
      const clockMins = clockMap.get(u.id) ?? 0;
      const jobSeconds = subTimerMap.get(u.id) ?? 0;
      const budget = budgetMap.get(u.id);
      const budgetMinutes = budget?.budgetMinutes ?? 0;
      const cb = callbackStatMap.get(u.id);
      const callbacks = cb?.callbackCount ?? 0;
      const completedJobs = cb?.completedJobs ?? 0;
      const callbackRatio = cb?.callbackRatio ?? 0;

      // Clock efficiency: active job time / total clock time
      const clockEfficiency =
        clockMins > 0 ? Math.min(Math.round((jobSeconds / (clockMins * 60)) * 100), 200) : null;

      // Budget efficiency: budget hrs / actual job hrs (Mike Andes P4P)
      const budgetEfficiency = budgetEff(budgetMinutes, jobSeconds);

      // Combined P4P score: budget efficiency penalised by callback ratio
      // For now surface both separately and let managers interpret
      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        clockMinutes: clockMins,
        jobSeconds: Math.round(jobSeconds),
        budgetMinutes,
        budgetJobCount: budget?.budgetJobCount ?? 0,
        clockEfficiency,
        budgetEfficiency,
        // Legacy field kept so existing UI doesn't break
        efficiencyRate: clockEfficiency,
        callbacks,
        completedJobs,
        callbackRatio,
        hasWarning: cb?.hasWarning ?? false,
      };
    });

  // Company-wide rollups
  const withClock = technicianMetrics.filter(t => t.clockEfficiency !== null);
  const companyEfficiencyRate =
    withClock.length > 0
      ? Math.round(withClock.reduce((s, t) => s + (t.clockEfficiency ?? 0), 0) / withClock.length)
      : null;

  const totalBudgetMinutes = technicianMetrics.reduce((s, t) => s + t.budgetMinutes, 0);
  const totalJobSeconds = technicianMetrics.reduce((s, t) => s + t.jobSeconds, 0);
  const companyBudgetEfficiency = budgetEff(totalBudgetMinutes, totalJobSeconds);
  const companyCallbackRatio = callbackStats.companyCallbackRatio;

  res.json({
    period,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    companyEfficiencyRate,
    companyBudgetEfficiency,
    companyCallbackRatio,
    totalBudgetMinutes,
    totalJobSeconds: Math.round(totalJobSeconds),
    technicians: technicianMetrics,
  });
});

// ── GET /efficiency/by-crew ──────────────────────────────────────────────────
router.get("/efficiency/by-crew", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { period = "today", startDate, endDate } = req.query as Record<string, string>;

  let rangeStart: Date, rangeEnd: Date;
  if (startDate && endDate) {
    rangeStart = new Date(startDate + "T00:00:00");
    rangeEnd = new Date(endDate + "T23:59:59");
  } else {
    ({ rangeStart, rangeEnd } = getPeriodRange(period));
  }

  // Budget minutes + completed jobs per crew
  const budgetRows = await db.execute(sql`
    SELECT
      crew_id,
      COALESCE(SUM(estimated_duration), 0) AS budget_minutes,
      COUNT(*)::int AS completed_jobs
    FROM jobs
    WHERE tenant_id = ${tenantId}
      AND status = 'completed'
      AND completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND completed_at <= ${rangeEnd.toISOString()}::timestamptz
      AND crew_id IS NOT NULL
    GROUP BY crew_id
  `);

  // Actual job seconds per crew (join sub_timers → jobs)
  const subRows = await db.execute(sql`
    SELECT
      j.crew_id,
      SUM(
        CASE WHEN st.is_active THEN EXTRACT(EPOCH FROM (NOW() - st.started_at)) ELSE st.elapsed_seconds END
      ) AS job_seconds
    FROM sub_timers st
    JOIN jobs j ON j.id = st.job_id
    WHERE st.tenant_id = ${tenantId}
      AND j.crew_id IS NOT NULL
      AND st.started_at >= ${rangeStart.toISOString()}::timestamptz
      AND st.started_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY j.crew_id
  `);

  // Callback tickets per crew, attributed to the crew on the original job.
  const callbackRows = await db.execute(sql`
    SELECT
      original_job.crew_id,
      COUNT(c.id)::int AS callbacks
    FROM callbacks c
    JOIN jobs original_job
      ON original_job.id = c.original_job_id
      AND original_job.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      AND c.created_at >= ${rangeStart.toISOString()}::timestamptz
      AND c.created_at <= ${rangeEnd.toISOString()}::timestamptz
      AND original_job.crew_id IS NOT NULL
    GROUP BY original_job.crew_id
  `);

  // All crews for this tenant
  const crews = await db
    .select({ id: crewsTable.id, name: crewsTable.name })
    .from(crewsTable)
    .where(eq(crewsTable.tenantId, tenantId));

  const budgetMap = new Map<number, { budgetMinutes: number; completedJobs: number }>();
  for (const r of budgetRows.rows as { crew_id: number; budget_minutes: string; completed_jobs: number }[]) {
    budgetMap.set(Number(r.crew_id), { budgetMinutes: Number(r.budget_minutes), completedJobs: Number(r.completed_jobs) });
  }
  const subMap = new Map<number, number>();
  for (const r of subRows.rows as { crew_id: number; job_seconds: string }[]) {
    subMap.set(Number(r.crew_id), Number(r.job_seconds ?? 0));
  }
  const cbMap = new Map<number, number>();
  for (const r of callbackRows.rows as { crew_id: number; callbacks: number }[]) {
    cbMap.set(Number(r.crew_id), Number(r.callbacks ?? 0));
  }
  const crewMetrics = crews.map(crew => {
    const b = budgetMap.get(crew.id);
    const budgetMinutes = b?.budgetMinutes ?? 0;
    const completedJobs = b?.completedJobs ?? 0;
    const jobSeconds = subMap.get(crew.id) ?? 0;
    const callbacks = cbMap.get(crew.id) ?? 0;
    const callbackRatio = completedJobs > 0 ? Math.round((callbacks / completedJobs) * 100 * 10) / 10 : 0;
    return {
      crewId: crew.id,
      name: crew.name,
      budgetMinutes,
      jobSeconds: Math.round(jobSeconds),
      completedJobs,
      callbacks,
      callbackRatio,
      budgetEfficiency: budgetEff(budgetMinutes, jobSeconds),
    };
  }).filter(c => c.completedJobs > 0 || c.jobSeconds > 0);

  res.json({ period, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), crews: crewMetrics });
});

// ── GET /efficiency/by-service ────────────────────────────────────────────────
router.get("/efficiency/by-service", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { period = "today", startDate, endDate } = req.query as Record<string, string>;

  let rangeStart: Date, rangeEnd: Date;
  if (startDate && endDate) {
    rangeStart = new Date(startDate + "T00:00:00");
    rangeEnd = new Date(endDate + "T23:59:59");
  } else {
    ({ rangeStart, rangeEnd } = getPeriodRange(period));
  }

  // Budget minutes + completed jobs per service.
  const budgetRows = await db.execute(sql`
    SELECT
      j.service_id,
      COALESCE(s.name, 'Unspecified') AS service_name,
      COALESCE(SUM(j.estimated_duration), 0) AS budget_minutes,
      COUNT(j.id)::int AS completed_jobs
    FROM jobs j
    LEFT JOIN services s ON s.id = j.service_id
    WHERE j.tenant_id = ${tenantId}
      AND j.status = 'completed'
      AND j.completed_at >= ${rangeStart.toISOString()}::timestamptz
      AND j.completed_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY j.service_id, s.name
  `);

  // Every callback ticket in the period, attributed to its original job's service.
  const callbackRows = await db.execute(sql`
    SELECT
      original_job.service_id,
      COUNT(c.id)::int AS callbacks
    FROM callbacks c
    JOIN jobs original_job
      ON original_job.id = c.original_job_id
      AND original_job.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      AND c.created_at >= ${rangeStart.toISOString()}::timestamptz
      AND c.created_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY original_job.service_id
  `);

  // Actual job seconds per service (join sub_timers → jobs)
  const subRows = await db.execute(sql`
    SELECT
      j.service_id,
      SUM(
        CASE WHEN st.is_active THEN EXTRACT(EPOCH FROM (NOW() - st.started_at)) ELSE st.elapsed_seconds END
      ) AS job_seconds
    FROM sub_timers st
    JOIN jobs j ON j.id = st.job_id
    WHERE st.tenant_id = ${tenantId}
      AND st.started_at >= ${rangeStart.toISOString()}::timestamptz
      AND st.started_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY j.service_id
  `);

  const subMap = new Map<string, number>();
  for (const r of subRows.rows as { service_id: number | null; job_seconds: string }[]) {
    const key = r.service_id != null ? String(r.service_id) : "null";
    subMap.set(key, Number(r.job_seconds ?? 0));
  }
  const callbackMap = new Map<string, number>();
  for (const r of callbackRows.rows as { service_id: number | null; callbacks: number }[]) {
    callbackMap.set(r.service_id != null ? String(r.service_id) : "null", Number(r.callbacks ?? 0));
  }

  const serviceMetrics = (budgetRows.rows as {
    service_id: number | null;
    service_name: string;
    budget_minutes: string;
    completed_jobs: number;
  }[]).map(r => {
    const key = r.service_id != null ? String(r.service_id) : "null";
    const budgetMinutes = Number(r.budget_minutes ?? 0);
    const jobSeconds = subMap.get(key) ?? 0;
    const completedJobs = Number(r.completed_jobs ?? 0);
    const callbacks = callbackMap.get(key) ?? 0;
    const callbackRatio = completedJobs > 0 ? Math.round((callbacks / completedJobs) * 100 * 10) / 10 : 0;
    return {
      serviceId: r.service_id ?? null,
      serviceName: r.service_name ?? "Unspecified",
      budgetMinutes,
      jobSeconds: Math.round(jobSeconds),
      completedJobs,
      callbacks,
      callbackRatio,
      budgetEfficiency: budgetEff(budgetMinutes, jobSeconds),
    };
  }).sort((a, b) => b.completedJobs - a.completedJobs);

  res.json({ period, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), services: serviceMetrics });
});

// ── GET /efficiency/trend?userId=&days=30 ────────────────────────────────────
router.get("/efficiency/trend", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { userId, days = "30" } = req.query as Record<string, string>;
  const daysNum = Math.min(parseInt(days, 10) || 30, 90);
  const since = subDays(new Date(), daysNum);

  const dailyClock = await db.execute(sql`
    SELECT
      DATE(COALESCE(adjusted_clocked_in_at, clocked_in_at) AT TIME ZONE 'UTC') AS day,
      SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
        COALESCE(adjusted_clocked_out_at, clocked_out_at)
        - COALESCE(adjusted_clocked_in_at, clocked_in_at)
      )) / 60))) AS clock_minutes
    FROM time_entries
    WHERE tenant_id = ${tenantId}
      AND is_master_clock = true
      ${userId ? sql`AND user_id = ${parseInt(userId, 10)}` : sql``}
      AND clocked_out_at IS NOT NULL
      AND COALESCE(adjusted_clocked_in_at, clocked_in_at) >= ${since.toISOString()}::timestamptz
    GROUP BY day
    ORDER BY day
  `);

  const dailySub = await db.execute(sql`
    SELECT
      DATE(started_at AT TIME ZONE 'UTC') AS day,
      SUM(
        CASE WHEN is_active THEN EXTRACT(EPOCH FROM (NOW() - started_at)) ELSE elapsed_seconds END
      ) AS job_seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id IS NOT NULL
      ${userId ? sql`AND user_id = ${parseInt(userId, 10)}` : sql``}
      AND started_at >= ${since.toISOString()}::timestamptz
    GROUP BY day
    ORDER BY day
  `);

  // Daily budget minutes (completed jobs)
  const dailyBudget = await db.execute(sql`
    SELECT
      DATE(completed_at AT TIME ZONE 'UTC') AS day,
      COALESCE(SUM(estimated_duration), 0) AS budget_minutes
    FROM jobs
    WHERE tenant_id = ${tenantId}
      AND status = 'completed'
      ${userId ? sql`AND assignee_id = ${parseInt(userId, 10)}` : sql``}
      AND completed_at >= ${since.toISOString()}::timestamptz
      AND estimated_duration IS NOT NULL
    GROUP BY day
    ORDER BY day
  `);

  const clockByDay = new Map<string, number>();
  for (const r of dailyClock.rows as { day: string; clock_minutes: number }[]) {
    clockByDay.set(String(r.day).slice(0, 10), Number(r.clock_minutes ?? 0));
  }
  const subByDay = new Map<string, number>();
  for (const r of dailySub.rows as { day: string; job_seconds: number }[]) {
    subByDay.set(String(r.day).slice(0, 10), Number(r.job_seconds ?? 0));
  }
  const budgetByDay = new Map<string, number>();
  for (const r of dailyBudget.rows as { day: string; budget_minutes: number }[]) {
    budgetByDay.set(String(r.day).slice(0, 10), Number(r.budget_minutes ?? 0));
  }

  const allDays = Array.from(new Set([...clockByDay.keys(), ...subByDay.keys()])).sort();
  const trend = allDays.map(day => {
    const clockMins = clockByDay.get(day) ?? 0;
    const jobSecs = subByDay.get(day) ?? 0;
    const budgetMins = budgetByDay.get(day) ?? 0;
    return {
      date: day,
      efficiencyRate: clockMins > 0 ? Math.min(Math.round((jobSecs / (clockMins * 60)) * 100), 200) : null,
      budgetEfficiency: budgetEff(budgetMins, jobSecs),
      clockMinutes: clockMins,
      jobMinutes: Math.round(jobSecs / 60),
      budgetMinutes: budgetMins,
    };
  });

  res.json({ userId: userId ? parseInt(userId, 10) : null, days: daysNum, trend });
});

export default router;
