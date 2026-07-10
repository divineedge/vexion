import { Router, type IRouter } from "express";
import { db, jobsTable, customersTable, usersTable, propertiesTable, activityLogTable, inventoryItemsTable, crewsTable, customerAlertsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatJob(
  j: typeof jobsTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null; crewName?: string | null }
) {
  return {
    ...j,
    lineItems: (j.lineItems as unknown[]) ?? [],
    jobParts: (j.jobParts as unknown[]) ?? [],
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    crewName: extras?.crewName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
    invoiceId: j.invoiceId ?? null,
    blueprintId: j.blueprintId ?? null,
    crewId: j.crewId ?? null,
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, assigneeId, startDate, endDate, customerId, crewId } = req.query as Record<string, string>;

  let where = eq(jobsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(jobsTable.status, status)) as typeof where;
  if (assigneeId) where = and(where, eq(jobsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (crewId) where = and(where, eq(jobsTable.crewId, parseInt(crewId, 10))) as typeof where;
  if (customerId) where = and(where, eq(jobsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (startDate) where = and(where, sql`${jobsTable.scheduledAt} >= ${startDate}::timestamptz`) as typeof where;
  if (endDate) where = and(where, sql`${jobsTable.scheduledAt} <= ${endDate}::timestamptz`) as typeof where;

  const rows = await db
    .select({
      job: jobsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      crewName: crewsTable.name,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(where)
    .orderBy(jobsTable.scheduledAt);

  res.json(rows.map(r => formatJob(r.job, { customerName: r.customerName, assigneeName: r.assigneeName, propertyAddress: r.propertyAddress, crewName: r.crewName })));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { title, description, status, priority, customerId, propertyId, assigneeId, crewId, scheduledAt, estimatedDuration, blueprintId } = req.body;

  if (!title || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title,
    description: description ?? null,
    status: status ?? "scheduled",
    priority: priority ?? "normal",
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    crewId: crewId ? parseInt(crewId, 10) : null,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    scheduledAt: new Date(scheduledAt),
    estimatedDuration: estimatedDuration ?? null,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_created", message: `Job "${title}" created`, entityId: job.id });

  res.status(201).json(formatJob(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ job: jobsTable, customerName: customersTable.name, assigneeName: usersTable.name, propertyAddress: propertiesTable.address, crewName: crewsTable.name })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(row.job, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress, crewName: row.crewName }));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { title, description, status, priority, assigneeId, crewId, scheduledAt, estimatedDuration } = req.body;
  const [updated] = await db.update(jobsTable)
    .set({
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assigneeId !== undefined && { assigneeId: assigneeId ? parseInt(assigneeId, 10) : null }),
      ...(crewId !== undefined && { crewId: crewId ? parseInt(crewId, 10) : null }),
      ...(scheduledAt && { scheduledAt: new Date(scheduledAt) }),
      ...(estimatedDuration !== undefined && { estimatedDuration }),
    })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [updated] = await db.update(jobsTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_completed", message: `Job "${updated.title}" completed`, entityId: id });

  res.json(formatJob(updated));
});

// ── Parts management on jobs ─────────────────────────────────────────────────

interface JobPart {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

router.get("/jobs/:id/parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [job] = await db.select({ jobParts: jobsTable.jobParts }).from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  res.json((job.jobParts as JobPart[]) ?? []);
});

// Add or update a part on a job (upserts by inventoryItemId)
router.post("/jobs/:id/parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { inventoryItemId, quantity } = req.body;

  if (!inventoryItemId || !quantity || quantity <= 0) {
    res.status(400).json({ error: "inventoryItemId and positive quantity are required" });
    return;
  }

  // Fetch the job and the inventory item
  const [[job], [item]] = await Promise.all([
    db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))),
    db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, inventoryItemId), eq(inventoryItemsTable.tenantId, tenantId))),
  ]);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }

  const existingParts = (job.jobParts as JobPart[]) ?? [];
  const sellPrice = item.markedUpPrice;
  const newPart: JobPart = {
    inventoryItemId: item.id,
    name: item.name,
    quantity,
    unitPrice: sellPrice,
    total: sellPrice * quantity,
  };

  // Upsert: replace if same item exists
  const updatedParts = [
    ...existingParts.filter(p => p.inventoryItemId !== inventoryItemId),
    newPart,
  ];

  const [updated] = await db.update(jobsTable)
    .set({ jobParts: updatedParts })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  res.json(formatJob(updated));
});

// Remove a part from a job
router.delete("/jobs/:id/parts/:inventoryItemId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const inventoryItemId = parseInt(req.params.inventoryItemId, 10);

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  const existingParts = (job.jobParts as JobPart[]) ?? [];
  const updatedParts = existingParts.filter(p => p.inventoryItemId !== inventoryItemId);

  const [updated] = await db.update(jobsTable)
    .set({ jobParts: updatedParts })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// GET /jobs/:id/alerts — list customer alerts on a job
// ---------------------------------------------------------------------------
router.get("/jobs/:id/alerts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const rows = await db
    .select()
    .from(customerAlertsTable)
    .where(and(eq(customerAlertsTable.jobId, id), eq(customerAlertsTable.tenantId, tenantId)))
    .orderBy(desc(customerAlertsTable.createdAt));

  res.json(rows.map(a => ({
    id: a.id,
    jobId: a.jobId,
    tenantId: a.tenantId,
    customerId: a.customerId ?? null,
    type: a.type,
    message: a.message,
    status: a.status,
    customerResponse: a.customerResponse ?? null,
    photoUrl: a.photoUrl ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  })));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/alerts — log a customer alert on a job
// ---------------------------------------------------------------------------
router.post("/jobs/:id/alerts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { type, message, photoUrl } = req.body as { type?: string; message?: string; photoUrl?: string };

  if (!type || !message) {
    res.status(400).json({ error: "type and message required" });
    return;
  }
  if (!["issue", "upsell"].includes(type)) {
    res.status(400).json({ error: "type must be issue or upsell" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [alert] = await db.insert(customerAlertsTable).values({
    tenantId,
    jobId: id,
    customerId: job.customerId ?? null,
    type,
    message,
    status: "pending",
    photoUrl: photoUrl ?? null,
  }).returning();

  res.status(201).json({
    id: alert.id,
    jobId: alert.jobId,
    tenantId: alert.tenantId,
    customerId: alert.customerId ?? null,
    type: alert.type,
    message: alert.message,
    status: alert.status,
    customerResponse: alert.customerResponse ?? null,
    photoUrl: alert.photoUrl ?? null,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  });
});

export default router;
