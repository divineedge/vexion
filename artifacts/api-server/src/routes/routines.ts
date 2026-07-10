import { Router, type IRouter } from "express";
import { db, routinesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatRoutine(r: typeof routinesTable.$inferSelect, assigneeName?: string | null) {
  return {
    ...r,
    assigneeName: assigneeName ?? null,
    lastCompletedAt: r.lastCompletedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/routines", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({ routine: routinesTable, assigneeName: usersTable.name })
    .from(routinesTable)
    .leftJoin(usersTable, eq(routinesTable.assigneeId, usersTable.id))
    .where(eq(routinesTable.tenantId, tenantId))
    .orderBy(routinesTable.name);

  res.json(rows.map(r => formatRoutine(r.routine, r.assigneeName)));
});

router.post("/routines", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, frequency, assigneeId, estimatedMinutes } = req.body;
  if (!name || !frequency) { res.status(400).json({ error: "name and frequency required" }); return; }

  const [routine] = await db.insert(routinesTable).values({
    tenantId,
    name,
    description: description ?? null,
    frequency,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    estimatedMinutes: estimatedMinutes ?? null,
  }).returning();

  res.status(201).json(formatRoutine(routine));
});

router.patch("/routines/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, description, frequency, assigneeId, estimatedMinutes, isActive } = req.body;
  const updates: Partial<typeof routinesTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (frequency) updates.frequency = frequency;
  if (assigneeId !== undefined) updates.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;
  if (isActive !== undefined) updates.isActive = isActive;

  const [updated] = await db.update(routinesTable).set(updates).where(and(eq(routinesTable.id, id), eq(routinesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [assignee] = updated.assigneeId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.assigneeId)) : [null];
  res.json(formatRoutine(updated, assignee?.name));
});

router.delete("/routines/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(routinesTable).where(and(eq(routinesTable.id, id), eq(routinesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
