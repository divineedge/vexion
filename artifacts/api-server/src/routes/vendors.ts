import { Router, type IRouter } from "express";
import { db, vendorsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

function fmt(v: typeof vendorsTable.$inferSelect) {
  return { ...v, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() };
}

router.get("/vendors", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const rows = await db.select().from(vendorsTable).where(eq(vendorsTable.tenantId, tenantId)).orderBy(vendorsTable.name);
  res.json(rows.map(fmt));
});

router.get("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [v] = await db.select().from(vendorsTable).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId)));
  if (!v) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(v));
});

router.post("/vendors", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { name, category, contact, notes } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [v] = await db.insert(vendorsTable).values({
    tenantId, name, category: category ?? null, contact: contact ?? null, notes: notes ?? null,
  }).returning();
  res.status(201).json(fmt(v));
});

router.patch("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const { name, category, contact, notes } = req.body;
  const update: Partial<typeof vendorsTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (category !== undefined) update.category = category;
  if (contact !== undefined) update.contact = contact;
  if (notes !== undefined) update.notes = notes;

  const [updated] = await db.update(vendorsTable).set(update).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  await db.delete(vendorsTable).where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
