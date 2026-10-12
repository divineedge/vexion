import { paymentGuardedJobInsert } from "../lib/paymentPolicy";
import { Router, type IRouter } from "express";
import {
  db, jobRequestsTable, jobsTable, customersTable, propertiesTable, servicesTable,
  usersTable, internalTasksTable, taskNotificationsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { getCallerRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";

const router: IRouter = Router();
const STAFF_ROLES = new Set(["company_owner", "office_manager", "department_manager", "crew_manager", "technician"]);
const REVIEWER_ROLES = new Set(["company_owner", "office_manager", "department_manager", "crew_manager"]);

router.use("/job-requests", requireVerifiedStaff);

function numericId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}
function dateValue(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function validateRelated(tenantId: number, customerId: number | null, propertyId: number | null, serviceId: number | null) {
  if (customerId != null) {
    const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId))).limit(1);
    if (!customer) return "Customer not found";
  }
  if (propertyId != null) {
    const [property] = await db.select({ id: propertiesTable.id, customerId: propertiesTable.customerId }).from(propertiesTable)
      .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId))).limit(1);
    if (!property || (customerId != null && property.customerId !== customerId)) return "Property not found for this customer";
  }
  if (serviceId != null) {
    const [service] = await db.select({ id: servicesTable.id }).from(servicesTable)
      .where(and(eq(servicesTable.id, serviceId), eq(servicesTable.tenantId, tenantId))).limit(1);
    if (!service) return "Service not found";
  }
  return null;
}

function formatRequest(row: typeof jobRequestsTable.$inferSelect, names: {
  requesterName?: string | null; customerName?: string | null; propertyAddress?: string | null;
  serviceName?: string | null; reviewerName?: string | null;
} = {}) {
  return {
    ...row,
    requestedStartDate: row.requestedStartDate.toISOString(),
    requestedEndDate: row.requestedEndDate?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requesterName: names.requesterName ?? null,
    customerName: names.customerName ?? null,
    propertyAddress: names.propertyAddress ?? null,
    serviceName: names.serviceName ?? null,
    reviewerName: names.reviewerName ?? null,
  };
}

async function notifyReviewers(tx: any, tenantId: number, requestId: number, requesterId: number, requesterName: string) {
  const reviewers = await tx.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true),
    inArray(usersTable.role, Array.from(REVIEWER_ROLES)),
  ));
  const [task] = await tx.insert(internalTasksTable).values({
    tenantId, title: "Review job request", description: `Job request submitted by ${requesterName}`,
    taskType: "job_request_review", createdById: requesterId,
    assignedToRole: "manager", priority: "normal", status: "open", contextType: "job_request", contextId: requestId,
  }).returning({ id: internalTasksTable.id });
  await Promise.all(reviewers.map((reviewer: { id: number }) => tx.insert(taskNotificationsTable).values({
    tenantId, recipientUserId: reviewer.id, taskId: task.id, type: "job_request",
    message: `${requesterName} submitted a job request for review`, isRead: false,
  })));
}

router.post("/job-requests", async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, requesterId = res.locals.staffUserId as number;
  const role = await getCallerRole(tenantId, requesterId);
  if (!STAFF_ROLES.has(role)) { res.status(403).json({ error: "Staff role required" }); return; }
  const customerId = req.body.customerId == null ? null : numericId(req.body.customerId);
  const propertyId = req.body.propertyId == null ? null : numericId(req.body.propertyId);
  const serviceId = req.body.serviceId == null ? null : numericId(req.body.serviceId);
  const requestedStartDate = dateValue(req.body.requestedStartDate);
  const requestedEndDate = req.body.requestedEndDate == null || req.body.requestedEndDate === "" ? null : dateValue(req.body.requestedEndDate);
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!requestedStartDate || !idempotencyKey || idempotencyKey.length > 255 || (req.body.customerId != null && customerId == null) || (req.body.propertyId != null && propertyId == null) || (req.body.serviceId != null && serviceId == null)) {
    res.status(400).json({ error: "A valid requestedStartDate and idempotencyKey are required" }); return;
  }
  if (requestedEndDate && requestedEndDate < requestedStartDate) { res.status(400).json({ error: "requestedEndDate must be on or after requestedStartDate" }); return; }
  const relatedError = await validateRelated(tenantId, customerId, propertyId, serviceId);
  if (relatedError) { res.status(404).json({ error: relatedError }); return; }
  const [existing] = await db.select().from(jobRequestsTable).where(and(
    eq(jobRequestsTable.tenantId, tenantId), eq(jobRequestsTable.requesterId, requesterId), eq(jobRequestsTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing) { res.status(200).json(formatRequest(existing)); return; }
  try {
    const created = await db.transaction(async tx => {
      const [row] = await tx.insert(jobRequestsTable).values({
        tenantId, requesterId, customerId, propertyId, serviceId, requestedStartDate, requestedEndDate,
        notes: typeof req.body.notes === "string" ? req.body.notes.trim() || null : null, idempotencyKey,
      }).returning();
      const [requester] = await tx.select({ name: usersTable.name }).from(usersTable).where(and(eq(usersTable.id, requesterId), eq(usersTable.tenantId, tenantId))).limit(1);
      await notifyReviewers(tx, tenantId, row.id, requesterId, requester?.name ?? "A staff member");
      return row;
    });
    res.status(201).json(formatRequest(created));
  } catch (error: any) {
    if (error?.code === "23505") {
      const [duplicate] = await db.select().from(jobRequestsTable).where(and(eq(jobRequestsTable.tenantId, tenantId), eq(jobRequestsTable.requesterId, requesterId), eq(jobRequestsTable.idempotencyKey, idempotencyKey))).limit(1);
      if (duplicate) { res.status(200).json(formatRequest(duplicate)); return; }
    }
    throw error;
  }
});

router.get("/job-requests", async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, userId = res.locals.staffUserId as number;
  const role = await getCallerRole(tenantId, userId);
  if (!STAFF_ROLES.has(role)) { res.status(403).json({ error: "Staff role required" }); return; }
  const where = and(eq(jobRequestsTable.tenantId, tenantId), ...(REVIEWER_ROLES.has(role) ? [] : [eq(jobRequestsTable.requesterId, userId)]));
  const rows = await db.select({
    request: jobRequestsTable, requesterName: usersTable.name, customerName: customersTable.name,
    propertyAddress: propertiesTable.address, serviceName: servicesTable.name,
  }).from(jobRequestsTable)
    .leftJoin(usersTable, and(eq(usersTable.id, jobRequestsTable.requesterId), eq(usersTable.tenantId, tenantId)))
    .leftJoin(customersTable, and(eq(customersTable.id, jobRequestsTable.customerId), eq(customersTable.tenantId, tenantId)))
    .leftJoin(propertiesTable, and(eq(propertiesTable.id, jobRequestsTable.propertyId), eq(propertiesTable.tenantId, tenantId)))
    .leftJoin(servicesTable, and(eq(servicesTable.id, jobRequestsTable.serviceId), eq(servicesTable.tenantId, tenantId)))
    .where(where).orderBy(desc(jobRequestsTable.createdAt));
  res.json(rows.map(row => formatRequest(row.request, row)));
});

async function requireReviewer(tenantId: number, userId: number, res: any) {
  if (!REVIEWER_ROLES.has(await getCallerRole(tenantId, userId))) {
    res.status(403).json({ error: "Manager role required" }); return false;
  }
  return true;
}
async function getRequest(tenantId: number, id: number) {
  const [request] = await db.select().from(jobRequestsTable).where(and(eq(jobRequestsTable.id, id), eq(jobRequestsTable.tenantId, tenantId))).limit(1);
  return request;
}

router.post("/job-requests/:id/approve", async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, userId = res.locals.staffUserId as number, id = numericId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid request id" }); return; }
  if (!await requireReviewer(tenantId, userId, res)) return;
  const scheduledAt = req.body.scheduledAt == null || req.body.scheduledAt === "" ? null : dateValue(req.body.scheduledAt);
  if (req.body.scheduledAt != null && !scheduledAt) { res.status(400).json({ error: "scheduledAt must be a valid ISO date" }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM job_requests WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
    const [request] = await tx.select().from(jobRequestsTable).where(and(eq(jobRequestsTable.id, id), eq(jobRequestsTable.tenantId, tenantId))).limit(1);
    if (!request) return { error: "Job request not found", status: 404 };
    if (request.status === "approved" && request.approvedJobId) return { request, jobId: request.approvedJobId };
    if (!["pending", "clarification_requested"].includes(request.status)) return { error: "Job request has already been reviewed", status: 409 };
    const relatedError = await validateRelated(tenantId, request.customerId, request.propertyId, request.serviceId);
    if (relatedError) return { error: relatedError, status: 409 };
    const [service] = request.serviceId == null ? [null] : await tx.select({ name: servicesTable.name }).from(servicesTable).where(and(eq(servicesTable.id, request.serviceId), eq(servicesTable.tenantId, tenantId))).limit(1);
    const [job] = await paymentGuardedJobInsert(tx).values({
      tenantId, title: service?.name ?? "Requested job", description: request.notes, status: "scheduled", priority: "normal",
      customerId: request.customerId, propertyId: request.propertyId, serviceId: request.serviceId,
      scheduledAt: scheduledAt ?? request.requestedStartDate, source: "staff",
    }).returning();
    const [updated] = await tx.update(jobRequestsTable).set({
      status: "approved", adminResponse: typeof req.body.adminResponse === "string" ? req.body.adminResponse.trim() || null : null,
      reviewedById: userId, reviewedAt: new Date(), approvedJobId: job.id,
    }).where(and(eq(jobRequestsTable.id, id), eq(jobRequestsTable.tenantId, tenantId), or(eq(jobRequestsTable.status, "pending"), eq(jobRequestsTable.status, "clarification_requested")))).returning();
    if (!updated) throw new Error("Job request status changed while approving");
    const [notificationTask] = await tx.insert(internalTasksTable).values({
      tenantId, title: "Job request approved", description: "Your requested job has been scheduled",
      taskType: "job_request_response", createdById: userId, assignedToUserId: request.requesterId,
      priority: "normal", status: "done", contextType: "job_request", contextId: id, completedAt: new Date(),
    }).returning({ id: internalTasksTable.id });
    await tx.insert(taskNotificationsTable).values({ tenantId, recipientUserId: request.requesterId, taskId: notificationTask.id, type: "job_request_approved", message: "Your job request was approved", isRead: false });
    return { request: updated, jobId: job.id };
  });
  if ("error" in result) { res.status(result.status ?? 409).json({ error: result.error }); return; }
  res.json({ ...formatRequest(result.request), approvedJobId: result.jobId });
});

async function reviewWithoutJob(req: any, res: any, status: "rejected" | "clarification_requested") {
  const tenantId = res.locals.staffTenantId as number, userId = res.locals.staffUserId as number, id = numericId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid request id" }); return; }
  if (!await requireReviewer(tenantId, userId, res)) return;
  const adminResponse = typeof req.body.adminResponse === "string" ? req.body.adminResponse.trim() : "";
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!adminResponse || !idempotencyKey) { res.status(400).json({ error: "adminResponse and idempotencyKey are required" }); return; }
  const request = await getRequest(tenantId, id);
  if (!request) { res.status(404).json({ error: "Job request not found" }); return; }
  if (request.reviewIdempotencyKey === idempotencyKey) { res.json(formatRequest(request)); return; }
  const reviewableStatuses = status === "clarification_requested" ? ["pending"] : ["pending", "clarification_requested"];
  if (!reviewableStatuses.includes(request.status)) { res.status(409).json({ error: "Job request has already been reviewed" }); return; }
  const updated = await db.transaction(async tx => {
    const statusPrecondition = status === "clarification_requested"
      ? eq(jobRequestsTable.status, "pending")
      : or(eq(jobRequestsTable.status, "pending"), eq(jobRequestsTable.status, "clarification_requested"));
    const [row] = await tx.update(jobRequestsTable).set({ status, adminResponse, reviewedById: userId, reviewedAt: new Date(), reviewIdempotencyKey: idempotencyKey })
      .where(and(eq(jobRequestsTable.id, id), eq(jobRequestsTable.tenantId, tenantId), statusPrecondition)).returning();
    if (!row) return null;
    const [notificationTask] = await tx.insert(internalTasksTable).values({
      tenantId, title: status === "rejected" ? "Job request declined" : "Job request clarification requested",
      description: adminResponse, taskType: "job_request_response", createdById: userId,
      assignedToUserId: request.requesterId, priority: "normal",
      status: status === "rejected" ? "done" : "open", contextType: "job_request", contextId: id,
      ...(status === "rejected" ? { completedAt: new Date() } : {}),
    }).returning({ id: internalTasksTable.id });
    await tx.insert(taskNotificationsTable).values({ tenantId, recipientUserId: request.requesterId, taskId: notificationTask.id, type: `job_request_${status}`, message: status === "rejected" ? "Your job request was declined" : "More information was requested for your job request", isRead: false });
    return row;
  });
  if (!updated) { res.status(409).json({ error: "Job request status changed while reviewing" }); return; }
  res.json(formatRequest(updated));
}
router.post("/job-requests/:id/reject", (req, res) => reviewWithoutJob(req, res, "rejected"));
router.post("/job-requests/:id/request-clarification", (req, res) => reviewWithoutJob(req, res, "clarification_requested"));

router.post("/job-requests/:id/amend", async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, requesterId = res.locals.staffUserId as number, id = numericId(req.params.id);
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (!id || !idempotencyKey) { res.status(400).json({ error: "idempotencyKey is required" }); return; }
  const request = await getRequest(tenantId, id);
  if (!request) { res.status(404).json({ error: "Job request not found" }); return; }
  if (request.requesterId !== requesterId) { res.status(403).json({ error: "Only the original requester can amend this request" }); return; }
  if (request.status === "pending" && request.amendmentIdempotencyKey === idempotencyKey) { res.json(formatRequest(request)); return; }
  if (request.status !== "clarification_requested") { res.status(409).json({ error: "Only requests awaiting clarification can be amended" }); return; }
  const updated = await db.transaction(async tx => {
    const [row] = await tx.update(jobRequestsTable).set({
      status: "pending", notes: typeof req.body.notes === "string" ? req.body.notes.trim() || null : request.notes,
      amendmentIdempotencyKey: idempotencyKey, adminResponse: null, reviewedById: null, reviewedAt: null,
    }).where(and(eq(jobRequestsTable.id, id), eq(jobRequestsTable.tenantId, tenantId), eq(jobRequestsTable.requesterId, requesterId), eq(jobRequestsTable.status, "clarification_requested"))).returning();
    if (!row) return null;
    const [user] = await tx.select({ name: usersTable.name }).from(usersTable).where(and(eq(usersTable.id, requesterId), eq(usersTable.tenantId, tenantId))).limit(1);
    await notifyReviewers(tx, tenantId, id, requesterId, user?.name ?? "A staff member");
    return row;
  });
  if (!updated) { res.status(409).json({ error: "Job request status changed while amending" }); return; }
  res.json(formatRequest(updated));
});

export default router;