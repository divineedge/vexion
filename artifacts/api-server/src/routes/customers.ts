import { Router, type IRouter } from "express";
import { db, customersTable, propertiesTable, jobsTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { q, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const baseWhere = eq(customersTable.tenantId, tenantId);
  const where = q ? and(baseWhere, ilike(customersTable.name, `%${q}%`)) : baseWhere;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable)
    .where(where);

  const rows = await db
    .select()
    .from(customersTable)
    .where(where)
    .orderBy(customersTable.createdAt)
    .limit(limitNum)
    .offset(offset);

  // Get property counts
  const propCounts = await db
    .select({ customerId: propertiesTable.customerId, count: sql<number>`count(*)::int` })
    .from(propertiesTable)
    .where(eq(propertiesTable.tenantId, tenantId))
    .groupBy(propertiesTable.customerId);

  const propMap = Object.fromEntries(propCounts.map(p => [p.customerId, p.count]));

  res.json({
    items: rows.map(c => ({
      ...c,
      tags: c.tags ?? [],
      propertyCount: propMap[c.id] ?? 0,
      totalSpend: c.totalSpend,
      createdAt: c.createdAt.toISOString(),
      updatedAt: undefined,
    })),
    total: count,
    page: pageNum,
    limit: limitNum,
  });
});

router.post("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, email, phone, company, notes, tags } = req.body;
  if (!name || !email || !phone) {
    res.status(400).json({ error: "name, email, phone are required" });
    return;
  }

  const [customer] = await db.insert(customersTable).values({
    tenantId,
    name,
    email,
    phone,
    company: company ?? null,
    notes: notes ?? null,
    tags: tags ?? [],
  }).returning();

  res.status(201).json({ ...customer, propertyCount: 0, tags: customer.tags ?? [], createdAt: customer.createdAt.toISOString() });
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable).where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));

  res.json({ ...customer, tags: customer.tags ?? [], propertyCount: count, createdAt: customer.createdAt.toISOString() });
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, email, phone, company, notes, tags } = req.body;

  const [updated] = await db.update(customersTable)
    .set({ ...(name && { name }), ...(email && { email }), ...(phone && { phone }), ...(company !== undefined && { company }), ...(notes !== undefined && { notes }), ...(tags !== undefined && { tags }) })
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable).where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));
  res.json({ ...updated, tags: updated.tags ?? [], propertyCount: count, createdAt: updated.createdAt.toISOString() });
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  await db.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
