import { and, eq, or } from "drizzle-orm";
import { blueprintsTable, db, estimatesTable, jobsTable } from "@workspace/db";
import type { Response } from "express";
import { lockReason } from "./blueprintPlanning";

export async function planningLockState(tenantId: number, blueprintId: number): Promise<{ locked: boolean; reason: string | null } | null> {
  const [blueprint] = await db
    .select({
      id: blueprintsTable.id,
      jobId: blueprintsTable.jobId,
      planningLocked: blueprintsTable.planningLocked,
      planningLockedReason: blueprintsTable.planningLockedReason,
    })
    .from(blueprintsTable)
    .where(and(eq(blueprintsTable.id, blueprintId), eq(blueprintsTable.tenantId, tenantId)));
  if (!blueprint) return null;

  const estimates = await db
    .select({ status: estimatesTable.status })
    .from(estimatesTable)
    .where(and(eq(estimatesTable.tenantId, tenantId), eq(estimatesTable.blueprintId, blueprintId)));
  const jobMatch = [eq(jobsTable.blueprintId, blueprintId)];
  if (blueprint.jobId) jobMatch.push(eq(jobsTable.id, blueprint.jobId));
  const jobs = await db
    .select({ status: jobsTable.status })
    .from(jobsTable)
    .where(and(eq(jobsTable.tenantId, tenantId), or(...jobMatch)));
  const reason = lockReason({
    estimateStatuses: estimates.map(estimate => estimate.status),
    jobStatuses: jobs.map(job => job.status ?? ""),
  });
  if (reason) {
    if (!blueprint.planningLocked || blueprint.planningLockedReason !== reason) {
      await db.update(blueprintsTable)
        .set({ planningLocked: true, planningLockedReason: reason })
        .where(and(eq(blueprintsTable.id, blueprintId), eq(blueprintsTable.tenantId, tenantId)));
    }
    return { locked: true, reason };
  }
  return { locked: blueprint.planningLocked, reason: blueprint.planningLockedReason };
}

/** Sends 409 when the blueprint can be viewed but not changed. Returns true if the response was sent. */
export async function rejectIfBlueprintLocked(res: Response, tenantId: number, blueprintId: number): Promise<boolean> {
  const state = await planningLockState(tenantId, blueprintId);
  if (!state?.locked) return false;
  res.status(409).json({ error: `This blueprint is locked because ${state.reason === "Job completed" ? "the job was completed" : "the estimate was accepted"}. You can view where the lines were run.` });
  return true;
}
