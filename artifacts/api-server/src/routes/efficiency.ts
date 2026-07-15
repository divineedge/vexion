/**
 * P4P Labor Efficiency Engine — Mike Andes methodology.
 *
 * Efficiency Rate = SUM(job sub-timer seconds) ÷ (total master-clock minutes × 60) × 100
 *
 * "Active" sub-timer seconds = all sub_timers with type='job' (or jobId set), stopped or still running.
 * Running timers have their live seconds added via NOW() - startedAt.
 * Un-assigned gaps and travel are NOT counted as productive time, so they naturally lower the score.
 */

import { Router, type IRouter } from "express";
import { db, timeEntriesTable, subTimersTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, sum } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { getCallbackRatioStats } from "../lib/callbackRatio";
import { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays, format } from "date-fns";

const router: IRouter = Router();

// GET /efficiency — company-wide + per-technician efficiency summary
router.get("/efficiency", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { period = "today" } = req.query as Record<string, string>;

  const { rangeStart, rangeEnd } = getPeriodRange(period);

  // ── Master clock minutes per user in period ──────────────────────────────
  const clockRows = await db
    .select({
      userId: timeEntriesTable.userId,
      totalClockMinutes: sum(timeEntriesTable.totalMinutes).mapWith(Number),
    })
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.tenantId, tenantId),
        eq(timeEntriesTable.isMasterClock, true),
        gte(timeEntriesTable.clockedInAt, rangeStart),
        lte(timeEntriesTable.clockedInAt, rangeEnd),
      ),
    )
    .groupBy(timeEntriesTable.userId);

  // ── Job sub-timer seconds per user in period ─────────────────────────────
  // Include currently-running timers via EXTRACT(EPOCH FROM (COALESCE(stopped_at, NOW()) - started_at))
  const subTimerRows = await db.execute(sql`
    SELECT
      user_id,
      SUM(
        CASE
          WHEN is_active = true
            THEN EXTRACT(EPOCH FROM (NOW() - started_at))
          ELSE elapsed_seconds
        END
      ) AS job_seconds
    FROM sub_timers
    WHERE tenant_id = ${tenantId}
      AND job_id IS NOT NULL
      AND started_at >= ${rangeStart.toISOString()}::timestamptz
      AND started_at <= ${rangeEnd.toISOString()}::timestamptz
    GROUP BY user_id
  `);

  // ── Callback ratio per user (all time — quality score) ───────────────────
  // Shared with GET /callbacks/stats so the two pages never report different numbers.
  const callbackStats = await getCallbackRatioStats(tenantId);
  const callbackStatMap = new Map(callbackStats.technicians.map(t => [t.userId, t]));

  // ── User names ────────────────────────────────────────────────────────────
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.tenantId, tenantId));

  // ── Merge ─────────────────────────────────────────────────────────────────
  const subTimerMap = new Map<number, number>();
  for (const row of subTimerRows.rows as { user_id: number; job_seconds: number }[]) {
    subTimerMap.set(Number(row.user_id), Number(row.job_seconds ?? 0));
  }

  const clockMap = new Map<number, number>();
  for (const row of clockRows) {
    clockMap.set(row.userId, row.totalClockMinutes ?? 0);
  }

  const technicianMetrics = users
    .filter(u => u.role === "technician" || u.role === "crew_manager")
    .map(u => {
      const clockMins = clockMap.get(u.id) ?? 0;
      const jobSeconds = subTimerMap.get(u.id) ?? 0;
      const cb = callbackStatMap.get(u.id);
      const callbacks = cb?.callbackCount ?? 0;
      const completedJobs = cb?.completedJobs ?? 0;
      const callbackRatio = cb?.callbackRatio ?? 0;

      const efficiencyRate =
        clockMins > 0 ? Math.min(Math.round((jobSeconds / (clockMins * 60)) * 100), 200) : null;

      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        clockMinutes: clockMins,
        jobSeconds: Math.round(jobSeconds),
        efficiencyRate,
        callbacks,
        completedJobs,
        callbackRatio,
        hasWarning: cb?.hasWarning ?? false, // shared threshold from callbackRatio.ts
      };
    });

  // ── Company averages ──────────────────────────────────────────────────────
  const withData = technicianMetrics.filter(t => t.efficiencyRate !== null);
  const companyEfficiencyRate =
    withData.length > 0
      ? Math.round(withData.reduce((s, t) => s + (t.efficiencyRate ?? 0), 0) / withData.length)
      : null;

  // Company-wide callback ratio comes straight from the shared calculation (not re-derived from
  // technicianMetrics) so it matches GET /callbacks/stats exactly, even though the list of
  // technicians shown here is filtered to technician/crew_manager roles.
  const companyCallbackRatio = callbackStats.companyCallbackRatio;

  res.json({
    period,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    companyEfficiencyRate,
    companyCallbackRatio,
    technicians: technicianMetrics,
  });
});

// GET /efficiency/trend?userId=&days=30 — historical daily efficiency for sparklines
router.get("/efficiency/trend", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { userId, days = "30" } = req.query as Record<string, string>;
  const daysNum = Math.min(parseInt(days, 10) || 30, 90);
  const since = subDays(new Date(), daysNum);

  const whereClause = userId
    ? and(
        eq(timeEntriesTable.tenantId, tenantId),
        eq(timeEntriesTable.isMasterClock, true),
        eq(timeEntriesTable.userId, parseInt(userId, 10)),
        gte(timeEntriesTable.clockedInAt, since),
      )
    : and(
        eq(timeEntriesTable.tenantId, tenantId),
        eq(timeEntriesTable.isMasterClock, true),
        gte(timeEntriesTable.clockedInAt, since),
      );

  // Daily master clock minutes
  const dailyClock = await db.execute(sql`
    SELECT
      DATE(clocked_in_at AT TIME ZONE 'UTC') AS day,
      SUM(total_minutes) AS clock_minutes
    FROM time_entries
    WHERE tenant_id = ${tenantId}
      AND is_master_clock = true
      ${userId ? sql`AND user_id = ${parseInt(userId, 10)}` : sql``}
      AND clocked_in_at >= ${since.toISOString()}::timestamptz
    GROUP BY day
    ORDER BY day
  `);

  // Daily job sub-timer seconds
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

  const clockByDay = new Map<string, number>();
  for (const r of dailyClock.rows as { day: string; clock_minutes: number }[]) {
    clockByDay.set(String(r.day).slice(0, 10), Number(r.clock_minutes ?? 0));
  }
  const subByDay = new Map<string, number>();
  for (const r of dailySub.rows as { day: string; job_seconds: number }[]) {
    subByDay.set(String(r.day).slice(0, 10), Number(r.job_seconds ?? 0));
  }

  const allDays = Array.from(new Set([...clockByDay.keys(), ...subByDay.keys()])).sort();
  const trend = allDays.map(day => {
    const clockMins = clockByDay.get(day) ?? 0;
    const jobSecs = subByDay.get(day) ?? 0;
    return {
      date: day,
      efficiencyRate: clockMins > 0 ? Math.min(Math.round((jobSecs / (clockMins * 60)) * 100), 200) : null,
      clockMinutes: clockMins,
      jobMinutes: Math.round(jobSecs / 60),
    };
  });

  res.json({ userId: userId ? parseInt(userId, 10) : null, days: daysNum, trend });
});

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

export default router;
