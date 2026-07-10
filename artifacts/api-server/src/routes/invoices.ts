import { Router, type IRouter } from "express";
import { db, invoicesTable, customersTable, jobsTable, activityLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatInvoice(i: typeof invoicesTable.$inferSelect, customerName?: string | null) {
  return {
    ...i,
    lineItems: (i.lineItems as unknown[]) ?? [],
    customerName: customerName ?? null,
    dueDate: i.dueDate?.toISOString() ?? null,
    paidAt: i.paidAt?.toISOString() ?? null,
    stripePaymentUrl: i.stripePaymentUrl ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

router.get("/invoices/financials-summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const [paid] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "paid")));
  const [outstanding] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), sql`status IN ('draft','sent')`));
  const [overdue] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "overdue")));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [paidMonth] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "paid"), sql`paid_at >= ${startOfMonth}`));

  const [avg] = await db.select({ avg: sql<number>`COALESCE(avg(total),0)::float` }).from(invoicesTable).where(eq(invoicesTable.tenantId, tenantId));

  res.json({
    totalRevenue: paid?.total ?? 0,
    totalOutstanding: outstanding?.total ?? 0,
    totalOverdue: overdue?.total ?? 0,
    paidThisMonth: paidMonth?.total ?? 0,
    averageInvoiceValue: avg?.avg ?? 0,
  });
});

router.get("/invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, customerId } = req.query as Record<string, string>;

  let where = eq(invoicesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(invoicesTable.status, status)) as typeof where;
  if (customerId) where = and(where, eq(invoicesTable.customerId, parseInt(customerId, 10))) as typeof where;

  const rows = await db
    .select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(where)
    .orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json(rows.map(r => formatInvoice(r.invoice, r.customerName)));
});

router.post("/invoices/from-job/:jobId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;
  const lineItems = (job.lineItems as unknown[]) ?? [];
  const subtotal = job.totalAmount;
  const tax = subtotal * 0.085;
  const total = subtotal + tax;

  const [invoice] = await db.insert(invoicesTable).values({
    tenantId,
    invoiceNumber: invoiceNum,
    customerId: job.customerId!,
    jobId: job.id,
    status: "draft",
    subtotal,
    tax,
    total,
    lineItems,
  }).returning();

  await db.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, jobId));
  await db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_sent", message: `Invoice ${invoiceNum} created from job`, entityId: invoice.id });

  res.status(201).json(formatInvoice(invoice));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, jobId, notes, dueDate, lineItems = [] } = req.body;
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }

  const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;
  const subtotal = lineItems.reduce((sum: number, li: { unitPrice: number; quantity: number }) => sum + (li.unitPrice * li.quantity), 0);
  const tax = subtotal * 0.085;
  const total = subtotal + tax;

  const [invoice] = await db.insert(invoicesTable).values({
    tenantId,
    invoiceNumber: invoiceNum,
    customerId: parseInt(customerId, 10),
    jobId: jobId ? parseInt(jobId, 10) : null,
    status: "draft",
    subtotal,
    tax,
    total,
    notes: notes ?? null,
    dueDate: dueDate ? new Date(dueDate) : null,
    lineItems,
  }).returning();

  res.status(201).json(formatInvoice(invoice));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatInvoice(row.invoice, row.customerName));
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { status, notes, dueDate } = req.body;
  const updates: Partial<typeof invoicesTable.$inferInsert> = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  if (status === "paid") { updates.paidAt = new Date(); }

  const [updated] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (status === "paid") {
    await db.insert(activityLogTable).values({ tenantId, userId, type: "payment_received", message: `Invoice ${updated.invoiceNumber} marked as paid`, entityId: id });
  }

  res.json(formatInvoice(updated));
});

export default router;
