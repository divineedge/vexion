import { Router, type IRouter } from "express";
import { db, callbacksTable, jobsTable, usersTable, activityLogTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { getCallbackRatioStats } from "../lib/callbackRatio";

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

  // Attribute the callback to the job's primary assignee — the same technician who is
  // credited with the completed job for the completed-jobs denominator elsewhere (callback
  // stats, efficiency). Keeping numerator and denominator on the same identity avoids a
  // technician showing a callback in the list while the ratio calc can't find any completed
  // jobs to divide by (and thus reports 0%).
  const resolvedAssigneeId = origJob.assigneeId ?? null;

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
  const result = await getCallbackRatioStats(tenantId);
  res.json(result);
});

export default router;
