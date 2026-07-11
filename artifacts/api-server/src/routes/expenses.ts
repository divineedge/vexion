import { Router, type IRouter } from "express";
import { db, expenseEntriesTable, vendorsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

async function vendorBelongsToTenant(tenantId: number, vendorId: number): Promise<boolean> {
  const [v] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.tenantId, tenantId)));
  return !!v;
}

function fmt(e: typeof expenseEntriesTable.$inferSelect, vendorName?: string | null) {
  return {
    ...e,
    vendorName: vendorName ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

router.get("/expenses", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { startDate, endDate, category, vendorId } = req.query as Record<string, string>;

  let where = eq(expenseEntriesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (startDate) where = and(where, sql`${expenseEntriesTable.date} >= ${startDate}`) as typeof where;
  if (endDate) where = and(where, sql`${expenseEntriesTable.date} <= ${endDate}`) as typeof where;
  if (category) where = and(where, eq(expenseEntriesTable.category, category)) as typeof where;
  if (vendorId) where = and(where, eq(expenseEntriesTable.vendorId, parseInt(vendorId, 10))) as typeof where;

  const rows = await db
    .select({ expense: expenseEntriesTable, vendorName: vendorsTable.name })
    .from(expenseEntriesTable)
    .leftJoin(vendorsTable, eq(expenseEntriesTable.vendorId, vendorsTable.id))
    .where(where)
    .orderBy(sql`${expenseEntriesTable.date} DESC`);

  res.json(rows.map(r => fmt(r.expense, r.vendorName)));
});

router.get("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select({ expense: expenseEntriesTable, vendorName: vendorsTable.name })
    .from(expenseEntriesTable)
    .leftJoin(vendorsTable, eq(expenseEntriesTable.vendorId, vendorsTable.id))
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.expense, row.vendorName));
});

router.post("/expenses", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { vendorId, date, amount, category, description, receiptUrl } = req.body;
  if (!date || amount == null) { res.status(400).json({ error: "date and amount are required" }); return; }
  if (vendorId && !(await vendorBelongsToTenant(tenantId, parseInt(vendorId, 10)))) {
    res.status(400).json({ error: "Invalid vendorId" }); return;
  }
  const [e] = await db.insert(expenseEntriesTable).values({
    tenantId,
    vendorId: vendorId ? parseInt(vendorId, 10) : null,
    date,
    amount: Number(amount),
    category: category ?? "other",
    description: description ?? null,
    receiptUrl: receiptUrl ?? null,
  }).returning();
  res.status(201).json(fmt(e));
});

router.patch("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const { vendorId, date, amount, category, description, receiptUrl } = req.body;
  if (vendorId && !(await vendorBelongsToTenant(tenantId, parseInt(vendorId, 10)))) {
    res.status(400).json({ error: "Invalid vendorId" }); return;
  }
  const update: Partial<typeof expenseEntriesTable.$inferInsert> = {};
  if (vendorId !== undefined) update.vendorId = vendorId ? parseInt(vendorId, 10) : null;
  if (date !== undefined) update.date = date;
  if (amount !== undefined) update.amount = Number(amount);
  if (category !== undefined) update.category = category;
  if (description !== undefined) update.description = description;
  if (receiptUrl !== undefined) update.receiptUrl = receiptUrl;

  const [updated] = await db.update(expenseEntriesTable).set(update).where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  await db.delete(expenseEntriesTable).where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
