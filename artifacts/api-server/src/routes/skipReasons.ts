/**
 * Skip Reasons — configurable list of reasons for skipping a job occurrence.
 * Each reason may carry an automatic action (notify_customer, flag_property, create_task).
 */
import { Router, type IRouter } from "express";
import { db, skipReasonsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

// GET /skip-reasons
router.get("/skip-reasons", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(skipReasonsTable)
    .where(eq(skipReasonsTable.tenantId, tenantId))
    .orderBy(asc(skipReasonsTable.sortOrder), asc(skipReasonsTable.createdAt));
  res.json(rows);
});

// POST /skip-reasons
router.post("/skip-reasons", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { label, action, actionConfig, isActive, sortOrder } = req.body as {
    label?: string;
    action?: string;
    actionConfig?: Record<string, unknown>;
    isActive?: boolean;
    sortOrder?: number;
  };

  if (!label || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  const validActions = ["none", "notify_customer", "flag_property", "create_task"];
  const resolvedAction = action && validActions.includes(action) ? action : "none";

  const [row] = await db
    .insert(skipReasonsTable)
    .values({
      tenantId,
      label: label.trim(),
      action: resolvedAction,
      actionConfig: actionConfig ?? {},
      isActive: isActive !== false,
      sortOrder: sortOrder ?? 0,
    })
    .returning();

  res.status(201).json(row);
});

// PATCH /skip-reasons/:id
router.patch("/skip-reasons/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { label, action, actionConfig, isActive, sortOrder } = req.body as {
    label?: string;
    action?: string;
    actionConfig?: Record<string, unknown>;
    isActive?: boolean;
    sortOrder?: number;
  };

  const updates: Partial<typeof skipReasonsTable.$inferInsert> = {};
  if (label !== undefined) updates.label = label.trim();
  if (action !== undefined) updates.action = action;
  if (actionConfig !== undefined) updates.actionConfig = actionConfig;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(skipReasonsTable)
    .set(updates)
    .where(and(eq(skipReasonsTable.id, id), eq(skipReasonsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /skip-reasons/:id
router.delete("/skip-reasons/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db
    .delete(skipReasonsTable)
    .where(and(eq(skipReasonsTable.id, id), eq(skipReasonsTable.tenantId, tenantId)));
  res.status(204).send();
});

export default router;
