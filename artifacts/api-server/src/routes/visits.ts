import { Router, type IRouter } from "express";
import { db, visitsTable, estimatesTable, jobsTable, customersTable, propertiesTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatVisit(
  v: typeof visitsTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null }
) {
  return {
    ...v,
    scheduledAt: v.scheduledAt?.toISOString() ?? null,
    completedAt: v.completedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
  };
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get("/visits", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { date, assigneeId, customerId } = req.query as Record<string, string>;

  let where = eq(visitsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (assigneeId) where = and(where, eq(visitsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (customerId) where = and(where, eq(visitsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    where = and(where, sql`${visitsTable.scheduledAt} >= ${start.toISOString()}::timestamptz`) as typeof where;
    where = and(where, sql`${visitsTable.scheduledAt} <= ${end.toISOString()}::timestamptz`) as typeof where;
  }

  const rows = await db
    .select({
      visit: visitsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(visitsTable)
    .leftJoin(customersTable, eq(visitsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(visitsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(visitsTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(desc(visitsTable.createdAt));

  res.json(rows.map(r => formatVisit(r.visit, {
    customerName: r.customerName,
    assigneeName: r.assigneeName,
    propertyAddress: r.propertyAddress,
  })));
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/visits", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, propertyId, assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;

  if (!purpose) {
    res.status(400).json({ error: "purpose is required" });
    return;
  }

  const [visit] = await db.insert(visitsTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    visitMode: visitMode ?? "scheduled",
    purpose,
    notes: notes ?? null,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true",
  }).returning();

  res.status(201).json(formatVisit(visit));
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/visits/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({
      visit: visitsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(visitsTable)
    .leftJoin(customersTable, eq(visitsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(visitsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(visitsTable.propertyId, propertiesTable.id))
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatVisit(row.visit, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress }));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch("/visits/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;

  const updateData: Partial<typeof visitsTable.$inferInsert> = {};
  if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (visitMode) updateData.visitMode = visitMode;
  if (purpose) updateData.purpose = purpose;
  if (notes !== undefined) updateData.notes = notes;
  if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (smsReminderEnabled !== undefined) updateData.smsReminderEnabled = smsReminderEnabled === true || smsReminderEnabled === "true";

  const [updated] = await db.update(visitsTable)
    .set(updateData)
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatVisit(updated));
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/visits/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── COMPLETE ──────────────────────────────────────────────────────────────────
router.post("/visits/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { outcomeNotes } = req.body;

  const [updated] = await db.update(visitsTable)
    .set({ completedAt: new Date(), outcomeNotes: outcomeNotes ?? null })
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatVisit(updated));
});

// ── CONVERT TO ESTIMATE ───────────────────────────────────────────────────────
router.post("/visits/:id/convert-to-estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [visit] = await db.select().from(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  if (!visit) { res.status(404).json({ error: "Not found" }); return; }

  const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [estimate] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: visit.customerId,
    propertyId: visit.propertyId,
    assigneeId: visit.assigneeId,
    visitMode: visit.visitMode,
    scheduledAt: null,
    expiresAt: defaultExpiry,
    notes: visit.notes ?? null,
    lineItems: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    status: "draft",
  }).returning();

  await db.update(visitsTable)
    .set({ convertedToEstimateId: estimate.id })
    .where(eq(visitsTable.id, id));

  res.status(201).json({ estimateId: estimate.id });
});

// ── CONVERT TO JOB ────────────────────────────────────────────────────────────
router.post("/visits/:id/convert-to-job", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [visit] = await db.select().from(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  if (!visit) { res.status(404).json({ error: "Not found" }); return; }

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title: visit.purpose,
    description: visit.notes ?? null,
    status: "scheduled",
    priority: "normal",
    customerId: visit.customerId,
    propertyId: visit.propertyId,
    assigneeId: visit.assigneeId,
    scheduledAt: visit.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    totalAmount: 0,
  }).returning();

  await db.update(visitsTable)
    .set({ convertedToJobId: job.id })
    .where(eq(visitsTable.id, id));

  res.status(201).json({ jobId: job.id });
});

export default router;
