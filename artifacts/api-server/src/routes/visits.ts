import { Router, type IRouter } from "express";
import { db, visitsTable, estimatesTable, jobsTable, customersTable, propertiesTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { getCallerRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { resolveJobAssignmentRecipientIds, resolveVisitAssignmentRecipientIds, sendStaffPush } from "../lib/pushNotifications";
import { canAccessVisit } from "../lib/visitAccess";

const router: IRouter = Router();

function notifyVisitAssignment(
  tenantId: number, visit: { id: number; purpose: string; assigneeId: number | null },
  eventKey: string, actorUserId?: number,
): void {
  void resolveVisitAssignmentRecipientIds(tenantId, visit.assigneeId)
    .then(recipientUserIds => sendStaffPush({
      tenantId, recipientUserIds: actorUserId ? recipientUserIds.filter(id => id !== actorUserId) : recipientUserIds,
      eventKey, title: "Visit assigned", body: `You have been assigned: ${visit.purpose}`,
      data: { type: "visit_assignment", visitId: visit.id },
    }))
    .catch(() => undefined);
}

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
router.get("/visits", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  const { date, assigneeId, customerId } = req.query as Record<string, string>;

  let where = eq(visitsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  const callerRole = await getCallerRole(tenantId, userId);
  if (callerRole === "technician") {
    where = and(where, eq(visitsTable.assigneeId, userId)) as typeof where;
  } else if (assigneeId) {
    where = and(where, eq(visitsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  }
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
  const userId = getUserId(req);
  const { customerId, propertyId, assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;

  if (!purpose) {
    res.status(400).json({ error: "purpose is required" });
    return;
  }
  if (!scheduledAt) {
    res.status(400).json({ error: "scheduledAt is required — visits must be scheduled before they can be logged" });
    return;
  }
  if (!assigneeId) {
    res.status(400).json({ error: "assigneeId is required — a technician must be assigned to every visit" });
    return;
  }
  if (!propertyId) {
    res.status(400).json({ error: "propertyId is required — a property must be selected for every visit" });
    return;
  }

  const [visit] = await db.insert(visitsTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: parseInt(propertyId, 10),
    assigneeId: parseInt(assigneeId, 10),
    visitMode: visitMode ?? "scheduled",
    purpose,
    notes: notes ?? null,
    scheduledAt: new Date(scheduledAt),
    smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true",
  }).returning();
  notifyVisitAssignment(tenantId, visit, `visit-assignment:${visit.id}:create`, userId);

  res.status(201).json(formatVisit(visit));
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/visits/:id", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || !(await canAccessVisit(tenantId, userId, id))) {
    res.status(404).json({ error: "Not found" }); return;
  }

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
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;
  const [current] = await db.select({ assigneeId: visitsTable.assigneeId }).from(visitsTable)
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId))).limit(1);

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
  if (assigneeId !== undefined && current?.assigneeId !== updated.assigneeId) {
    notifyVisitAssignment(
      tenantId,
      updated,
      `visit-assignment:${updated.id}:update:${updated.updatedAt.getTime()}`,
      userId,
    );
  }
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
router.post("/visits/:id/convert-to-job", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  if (!["company_owner", "office_manager", "department_manager", "crew_manager"].includes(await getCallerRole(tenantId, res.locals.staffUserId as number))) {
    res.status(403).json({ error: "Manager role required to convert visits to jobs" }); return;
  }
  const id = parseInt(String(req.params.id), 10);

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
  if (job.assigneeId) {
    void resolveJobAssignmentRecipientIds(tenantId, job.assigneeId, null).then(recipientUserIds => sendStaffPush({
      tenantId,
      recipientUserIds: recipientUserIds.filter(userId => userId !== res.locals.staffUserId as number),
      eventKey: `job-assignment:${job.id}:visit-conversion`,
      title: "Job assigned",
      body: `You have been assigned: ${job.title}`,
      data: { type: "job_assignment", jobId: job.id },
    }));
  }

  res.status(201).json({ jobId: job.id });
});

export default router;
