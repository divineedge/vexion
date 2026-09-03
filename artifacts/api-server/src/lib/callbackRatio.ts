import { db, callbacksTable, jobsTable, usersTable } from "@workspace/db";
import { eq, and, count, gte, lte } from "drizzle-orm";

export interface TechnicianCallbackStat {
  userId: number;
  name: string;
  callbackCount: number;
  completedJobs: number;
  callbackRatio: number;
  hasWarning: boolean;
}

export interface CallbackRatioStats {
  companyCallbackRatio: number;
  totalCallbacks: number;
  totalCompleted: number;
  technicians: TechnicianCallbackStat[];
}

const WARNING_THRESHOLD_PCT = 10;

/**
 * Shared "callback ratio" calculation: callbacks ÷ completed jobs, per technician, plus a
 * company-wide total. Used by both GET /callbacks/stats and GET /efficiency so the two pages
 * can never drift apart.
 *
 * Both sides of the ratio are keyed on the same technician identity:
 *  - Numerator: callbacks.originalAssigneeId (set at creation time to the original job's
 *    primary assignee — see POST /callbacks).
 *  - Denominator: jobs.assigneeId for status = 'completed' — the technician credited with the
 *    completed job.
 * Because a callback's originalAssigneeId is always copied from the same job's assigneeId,
 * every technician with a callback is guaranteed to also appear in the completed-jobs
 * denominator (assuming the original job is completed), so ratios never silently collapse to 0%
 * due to attribution mismatches.
 */
export async function getCallbackRatioStats(
  tenantId: number,
  range?: { rangeStart?: Date; rangeEnd?: Date },
): Promise<CallbackRatioStats> {
  // Callbacks per assignee
  const cbRows = await db
    .select({
      userId: callbacksTable.originalAssigneeId,
      userName: usersTable.name,
      callbackCount: count().mapWith(Number),
    })
    .from(callbacksTable)
    .leftJoin(usersTable, eq(callbacksTable.originalAssigneeId, usersTable.id))
    .where(and(
      eq(callbacksTable.tenantId, tenantId),
      ...(range?.rangeStart ? [gte(callbacksTable.createdAt, range.rangeStart)] : []),
      ...(range?.rangeEnd ? [lte(callbacksTable.createdAt, range.rangeEnd)] : []),
    ))
    .groupBy(callbacksTable.originalAssigneeId, usersTable.name);

  // All techs with any completed jobs — correct denominator, includes techs with 0 callbacks
  const jobRows = await db
    .select({
      userId: jobsTable.assigneeId,
      userName: usersTable.name,
      completedCount: count().mapWith(Number),
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.status, "completed"),
      ...(range?.rangeStart ? [gte(jobsTable.completedAt, range.rangeStart)] : []),
      ...(range?.rangeEnd ? [lte(jobsTable.completedAt, range.rangeEnd)] : []),
    ))
    .groupBy(jobsTable.assigneeId, usersTable.name);

  const cbMap = new Map<number, { callbackCount: number; name: string }>();
  for (const r of cbRows) {
    if (r.userId != null) cbMap.set(r.userId, { callbackCount: r.callbackCount, name: r.userName ?? "Unknown" });
  }

  const stats: TechnicianCallbackStat[] = jobRows
    .filter((r): r is typeof r & { userId: number } => r.userId != null)
    .map(r => {
      const callbacks = cbMap.get(r.userId)?.callbackCount ?? 0;
      const ratio = r.completedCount > 0 ? Math.round((callbacks / r.completedCount) * 100 * 10) / 10 : 0;
      return {
        userId: r.userId,
        name: r.userName ?? "Unknown",
        callbackCount: callbacks,
        completedJobs: r.completedCount,
        callbackRatio: ratio,
        hasWarning: ratio > WARNING_THRESHOLD_PCT,
      };
    });

  // Techs with callbacks but no completed jobs on record — an edge case (e.g. the original job
  // was later reassigned or deleted after the callback was logged). Surface them at 0% rather
  // than dropping them, but this should not occur for normal data since attribution is copied
  // from the same job's assigneeId.
  for (const [userId, { callbackCount, name }] of cbMap) {
    if (!stats.some(s => s.userId === userId)) {
      stats.push({
        userId,
        name,
        callbackCount,
        completedJobs: 0,
        callbackRatio: 0,
        hasWarning: false,
      });
    }
  }

  const totalCallbacks = stats.reduce((s, r) => s + r.callbackCount, 0);
  const totalCompleted = stats.reduce((s, r) => s + r.completedJobs, 0);
  const companyCallbackRatio = totalCompleted > 0 ? Math.round((totalCallbacks / totalCompleted) * 100 * 10) / 10 : 0;

  return { companyCallbackRatio, totalCallbacks, totalCompleted, technicians: stats };
}
