import { Router, type IRouter } from "express";
import { db, callbacksTable, jobsTable, usersTable, activityLogTable, subTimersTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

// GET /callbacks — list all callbacks for tenant
router.get("/callbacks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { assigneeId, status } = req.query as Record<string, string>;

  const rows = await db
    .select({
      callback: callbacksTable,
      originalJobTitle: jobsTable.title,
      assigneeName: usersTable.name,
    })
    .from(callbacksTable)
    .leftJoin(jobsTable, eq(callbacksTable.originalJobId, jobsTable.id))
    .leftJoin(usersTable, eq(callbacksTable.originalAssigneeId, usersTable.id))
    .where(eq(callbacksTable.tenantId, tenantId))
    .orderBy(desc(callbacksTable.createdAt));

  let result = rows.map(r => ({
    ...r.callback,
    originalJobTitle: r.originalJobTitle ?? null,
    assigneeName: r.assigneeName ?? null,
    createdAt: r.callback.createdAt.toISOString(),
    resolvedAt: r.callback.resolvedAt?.toISOString() ?? null,
    scheduledFixDate: r.callback.scheduledFixDate?.toISOString() ?? null,
  }));

  if (assigneeId) {
    result = result.filter(r => r.originalAssigneeId === parseInt(assigneeId, 10));
  }
  if (status) {
    result = result.filter(r => r.status === status);
  }

  res.json(result);
});

// POST /callbacks — create a new callback ticket
router.post("/callbacks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { originalJobId, reason, callbackJobId, scheduledFixDate } = req.body;

  if (!originalJobId) {
    res.status(400).json({ error: "originalJobId is required" });
    return;
  }

  // Verify original job belongs to tenant
  const [origJob] = await db
    .select({ id: jobsTable.id, assigneeId: jobsTable.assigneeId, title: jobsTable.title })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, parseInt(originalJobId, 10)), eq(jobsTable.tenantId, tenantId)));

  if (!origJob) {
    res.status(404).json({ error: "Original job not found" });
    return;
  }

  // Validate callbackJobId belongs to this tenant
  if (callbackJobId) {
    const [cbJob] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, parseInt(callbackJobId, 10)), eq(jobsTable.tenantId, tenantId)));
    if (!cbJob) {
      res.status(404).json({ error: "Callback job not found" });
      return;
    }
  }

  // Auto-detect the responsible technician from sub-timers (clocked-in crew members).
  // Use DISTINCT user IDs so multiple timer segments for the same person count as one.
  // Falls back to the job's primary assignee when zero or multiple distinct technicians are found.
  let resolvedAssigneeId = origJob.assigneeId ?? null;
  const subTimerRows = await db
    .select({ userId: subTimersTable.userId })
    .from(subTimersTable)
    .where(eq(subTimersTable.jobId, origJob.id));

  const distinctUserIds = [...new Set(subTimerRows.map(r => r.userId))];
  if (distinctUserIds.length === 1) {
    // Exactly one technician clocked into this job — unambiguous attribution
    resolvedAssigneeId = distinctUserIds[0];
  }
  // If 0 or 2+ distinct users: fall back to job's primary assignee.

  const [callback] = await db
    .insert(callbacksTable)
    .values({
      tenantId,
      originalJobId: origJob.id,
      originalAssigneeId: resolvedAssigneeId,
      callbackJobId: callbackJobId ? parseInt(callbackJobId, 10) : null,
      reason: reason ?? null,
      scheduledFixDate: scheduledFixDate ? new Date(scheduledFixDate) : null,
      status: "open",
    })
    .returning();

  await db.insert(activityLogTable).values({
    tenantId,
    userId,
    type: "callback_created",
    message: `Callback logged against job "${origJob.title}"`,
    entityId: callback.id,
  });

  res.status(201).json({
    ...callback,
    createdAt: callback.createdAt.toISOString(),
    resolvedAt: null,
    scheduledFixDate: callback.scheduledFixDate?.toISOString() ?? null,
  });
});

// PATCH /callbacks/:id — update status (resolve, reopen)
router.patch("/callbacks/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { status, reason, callbackJobId, resolutionNotes, scheduledFixDate } = req.body;

  const updates: Partial<typeof callbacksTable.$inferInsert> = {};
  if (status) updates.status = status;
  if (reason) updates.reason = reason;
  if (resolutionNotes !== undefined) updates.resolutionNotes = resolutionNotes || null;
  if (scheduledFixDate !== undefined) updates.scheduledFixDate = scheduledFixDate ? new Date(scheduledFixDate) : null;
  if (callbackJobId !== undefined) updates.callbackJobId = callbackJobId ? parseInt(callbackJobId, 10) : null;
  if (status === "resolved") updates.resolvedAt = new Date();
  if (status === "open") updates.resolvedAt = null; // clear resolvedAt on reopen

  const [updated] = await db
    .update(callbacksTable)
    .set(updates)
    .where(and(eq(callbacksTable.id, id), eq(callbacksTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Callback not found" }); return; }
  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    scheduledFixDate: updated.scheduledFixDate?.toISOString() ?? null,
  });
});

// DELETE /callbacks/:id
router.delete("/callbacks/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(callbacksTable).where(and(eq(callbacksTable.id, id), eq(callbacksTable.tenantId, tenantId)));
  res.status(204).send();
});

// GET /callbacks/stats — per-technician callback ratios + company summary
router.get("/callbacks/stats", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  // Callbacks per assignee
  const cbRows = await db
    .select({
      userId: callbacksTable.originalAssigneeId,
      userName: usersTable.name,
      callbackCount: count().mapWith(Number),
    })
    .from(callbacksTable)
    .leftJoin(usersTable, eq(callbacksTable.originalAssigneeId, usersTable.id))
    .where(eq(callbacksTable.tenantId, tenantId))
    .groupBy(callbacksTable.originalAssigneeId, usersTable.name);

  // ALL techs with any completed jobs (correct denominator — includes techs with 0 callbacks)
  const jobRows = await db
    .select({
      userId: jobsTable.assigneeId,
      userName: usersTable.name,
      completedCount: count().mapWith(Number),
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.status, "completed")))
    .groupBy(jobsTable.assigneeId, usersTable.name);

  const cbMap = new Map<number, number>();
  for (const r of cbRows) {
    if (r.userId) cbMap.set(r.userId, r.callbackCount);
  }

  // Build from the complete set of techs with completed jobs
  const stats = jobRows
    .filter(r => r.userId !== null)
    .map(r => {
      const callbacks = cbMap.get(r.userId!) ?? 0;
      const ratio = r.completedCount > 0 ? Math.round((callbacks / r.completedCount) * 100 * 10) / 10 : 0;
      return {
        userId: r.userId!,
        name: r.userName ?? "Unknown",
        callbackCount: callbacks,
        completedJobs: r.completedCount,
        callbackRatio: ratio,
        hasWarning: ratio > 10,
      };
    });

  // Also include techs with callbacks but 0 completed jobs (shouldn't happen, but be safe)
  for (const r of cbRows) {
    if (r.userId && !stats.some(s => s.userId === r.userId)) {
      stats.push({
        userId: r.userId,
        name: r.userName ?? "Unknown",
        callbackCount: r.callbackCount,
        completedJobs: 0,
        callbackRatio: 0,
        hasWarning: false,
      });
    }
  }

  const totalCallbacks = stats.reduce((s, r) => s + r.callbackCount, 0);
  const totalCompleted = stats.reduce((s, r) => s + r.completedJobs, 0);
  const companyRatio = totalCompleted > 0 ? Math.round((totalCallbacks / totalCompleted) * 100 * 10) / 10 : 0;

  res.json({ companyCallbackRatio: companyRatio, totalCallbacks, totalCompleted, technicians: stats });
});

export default router;
