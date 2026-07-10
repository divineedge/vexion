import { Router, type IRouter } from "express";
import { db, estimateTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function fmt(t: typeof estimateTemplatesTable.$inferSelect) {
  return {
    ...t,
    lineItems: (t.lineItems as unknown[]) ?? [],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/estimate-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(estimateTemplatesTable).where(eq(estimateTemplatesTable.tenantId, tenantId));
  res.json(rows.map(fmt));
});

router.post("/estimate-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, lineItems } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [t] = await db.insert(estimateTemplatesTable).values({ tenantId, name, description: description ?? null, lineItems: lineItems ?? [] }).returning();
  res.status(201).json(fmt(t));
});

router.get("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [t] = await db.select().from(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(t));
});

router.patch("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, lineItems } = req.body;
  const update: Partial<typeof estimateTemplatesTable.$inferInsert> = {};
  if (name) update.name = name;
  if (description !== undefined) update.description = description;
  if (lineItems !== undefined) update.lineItems = lineItems;
  const [updated] = await db.update(estimateTemplatesTable).set(update).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
