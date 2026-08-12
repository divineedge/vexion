import { Router, type IRouter } from "express";
import { getStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";
import crypto from "crypto";
import { db, jobsTable, customersTable, usersTable, propertiesTable, activityLogTable, inventoryItemsTable, crewsTable, customerAlertsTable, invoicesTable, tenantsTable, blueprintsTable, chemicalApplicationsTable, chemicalProductsTable, chemicalMixtureItemsTable, customerPlansTable, equipmentFuelLogsTable, routeTemplatesTable, skipReasonsTable, taskNotificationsTable, internalTasksTable } from "@workspace/db";
import { eq, and, or, sql, desc, asc, isNotNull, isNull, ne, inArray, min, gt } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { getCallerRole, isAdminRole } from "../lib/roles";
import { resendReminderForJob } from "../lib/reminderScheduler";
import { nthOccurrenceAfterRoot, describeRule, type RecurrenceRule } from "../lib/recurrenceEngine";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { checkRainBeforeWindow } from "../lib/weatherCheck";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  optionalDate,
  registerImportExportConfig,
  encodeLineItemsCell,
  decodeLineItemsCell,
  sumLineItems,
  type ImportExportEntityConfig,
  type LineItemCsvShape,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const jobsImportExportConfig: ImportExportEntityConfig = {
  entityKey: "jobs",
  fields: [
    { key: "id", header: "ID", hint: "Include to update an existing job instead of creating a new one" },
    { key: "title", header: "Title", required: true },
    { key: "customerEmail", header: "Customer Email", hint: "Looked up against existing customers" },
    { key: "propertyAddress", header: "Property Address", hint: "Looked up within the matched customer's properties" },
    { key: "scheduledAt", header: "Scheduled At", required: true, hint: "Date/time" },
    { key: "status", header: "Status", hint: "e.g. scheduled, in_progress, completed, cancelled" },
    { key: "priority", header: "Priority", hint: "e.g. low, normal, high, urgent" },
    { key: "estimatedDuration", header: "Estimated Duration (min)" },
    { key: "totalAmount", header: "Total Amount", hint: "Auto-computed from Line Items if left blank" },
    { key: "description", header: "Description" },
    {
      key: "lineItems",
      header: "Line Items",
      hint: 'Optional. Format: "description=Mow lawn|qty=1|unitprice=75; description=Trim hedges|qty=2|unitprice=40". See docs for full syntax (markup, discount, optional, accepted).',
    },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "title", header: "Title" },
    { key: "customerName", header: "Customer Name" },
    { key: "customerEmail", header: "Customer Email" },
    { key: "propertyAddress", header: "Property Address" },
    { key: "scheduledAt", header: "Scheduled At" },
    { key: "status", header: "Status" },
    { key: "priority", header: "Priority" },
    { key: "estimatedDuration", header: "Estimated Duration (min)" },
    { key: "totalAmount", header: "Total Amount" },
    { key: "description", header: "Description" },
    { key: "lineItems", header: "Line Items" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(jobsTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.status) where = and(where, eq(jobsTable.status, query.status)) as typeof where;
    if (query.customerId) where = and(where, eq(jobsTable.customerId, parseInt(query.customerId, 10))) as typeof where;
    if (query.crewId) where = and(where, eq(jobsTable.crewId, parseInt(query.crewId, 10))) as typeof where;
    if (query.assigneeId) where = and(where, eq(jobsTable.assigneeId, parseInt(query.assigneeId, 10))) as typeof where;
    if (query.startDate) where = and(where, sql`${jobsTable.scheduledAt} >= ${query.startDate}::timestamptz`) as typeof where;
    if (query.endDate) where = and(where, sql`${jobsTable.scheduledAt} <= ${query.endDate}::timestamptz`) as typeof where;

    const rows = await db
      .select({
        job: jobsTable,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        propertyAddress: propertiesTable.address,
      })
      .from(jobsTable)
      .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(where)
      .orderBy(jobsTable.scheduledAt);

    return rows.map((r) => ({
      id: r.job.id,
      title: r.job.title,
      customerName: r.customerName ?? "",
      customerEmail: r.customerEmail ?? "",
      propertyAddress: r.propertyAddress ?? "",
      scheduledAt: r.job.scheduledAt.toISOString(),
      status: r.job.status,
      priority: r.job.priority,
      estimatedDuration: r.job.estimatedDuration ?? "",
      totalAmount: r.job.totalAmount,
      description: r.job.description ?? "",
      lineItems: encodeLineItemsCell((r.job.lineItems as LineItemCsvShape[]) ?? []),
      createdAt: r.job.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const title = requireString(raw.title, "Title", errors);
    const scheduledAt = optionalDate(raw.scheduledAt, "Scheduled At", errors);
    if (!raw.scheduledAt?.trim()) errors.push("Scheduled At is required");
    const lineItems = decodeLineItemsCell(raw.lineItems, errors);
    if (errors.length > 0 || !title || !scheduledAt) return { ok: false, errors };

    let customerId: number | null = null;
    if (raw.customerEmail?.trim()) {
      const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${raw.customerEmail.trim()})`))
        .limit(1);
      if (!customer) return { ok: false, errors: [`No customer found with email "${raw.customerEmail}"`] };
      customerId = customer.id;
    }

    let propertyId: number | null = null;
    if (raw.propertyAddress?.trim()) {
      if (!customerId) return { ok: false, errors: ["Property Address was given without a matching Customer Email"] };
      const [property] = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(and(
          eq(propertiesTable.tenantId, tenantId),
          eq(propertiesTable.customerId, customerId),
          sql`lower(${propertiesTable.address}) = lower(${raw.propertyAddress.trim()})`,
        ))
        .limit(1);
      if (!property) return { ok: false, errors: [`No property found at "${raw.propertyAddress}" for that customer`] };
      propertyId = property.id;
    }

    const idNum = optionalNumber(raw.id, "ID", errors);
    const estimatedDuration = optionalNumber(raw.estimatedDuration, "Estimated Duration", errors);
    const totalAmount = optionalNumber(raw.totalAmount, "Total Amount", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        ...(idNum != null ? { id: idNum } : {}),
        title,
        scheduledAt,
        customerId,
        propertyId,
        status: optionalString(raw.status) ?? "scheduled",
        priority: optionalString(raw.priority) ?? "normal",
        estimatedDuration: estimatedDuration ?? null,
        totalAmount: totalAmount ?? (lineItems.length > 0 ? sumLineItems(lineItems) : 0),
        description: optionalString(raw.description) ?? null,
        ...(lineItems.length > 0 ? { lineItems } : {}),
      },
    };
  },
  findExisting: async (tenantId, values) => {
    const idRaw = values.id;
    if (idRaw == null) return null;
    const id = Number(idRaw);
    if (Number.isNaN(id)) return null;
    const [existing] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const { id: _ignoredId, ...rest } = values;
    const [row] = await db.insert(jobsTable).values({ tenantId, ...rest } as typeof jobsTable.$inferInsert).returning({ id: jobsTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    const { id: _ignoredId, ...rest } = values;
    await db.update(jobsTable).set(rest as Partial<typeof jobsTable.$inferInsert>)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  },
  getDependents: async (tenantId, id) => {
    const [invRow] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.jobId, id)));
    const [alertRow] = await db.select({ count: sql<number>`count(*)` }).from(customerAlertsTable).where(and(eq(customerAlertsTable.tenantId, tenantId), eq(customerAlertsTable.jobId, id)));
    const [fuelRow] = await db.select({ count: sql<number>`count(*)` }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.tenantId, tenantId), eq(equipmentFuelLogsTable.jobId, id)));
    const invCount = Number(invRow?.count ?? 0);
    const alertCount = Number(alertRow?.count ?? 0);
    const fuelCount = Number(fuelRow?.count ?? 0);
    const parts: string[] = [];
    if (invCount > 0) parts.push(`${invCount} linked invoice${invCount === 1 ? "" : "s"}`);
    if (alertCount > 0) parts.push(`${alertCount} customer alert${alertCount === 1 ? "" : "s"}`);
    if (fuelCount > 0) parts.push(`${fuelCount} fuel log${fuelCount === 1 ? "" : "s"}`);
    return parts.length > 0 ? `still has ${parts.join(", ")} — delete those first, then undo this import again` : null;
  },
};
registerImportExportConfig(jobsImportExportConfig);

router.get("/jobs/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), jobsImportExportConfig);
});

router.post("/jobs/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), jobsImportExportConfig);
});

router.post("/jobs/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), jobsImportExportConfig);
});

function formatJob(
  j: typeof jobsTable.$inferSelect,
  extras?: { customerName?: string | null; customerPhone?: string | null; customerNotes?: string | null; assigneeName?: string | null; propertyAddress?: string | null; propertyNotes?: string | null; crewName?: string | null; planName?: string | null; routeName?: string | null }
) {
  const rule = j.recurrenceRule as unknown as RecurrenceRule | null;
  return {
    ...j,
    lineItems: (j.lineItems as unknown[]) ?? [],
    jobParts: (j.jobParts as unknown[]) ?? [],
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    customerName: extras?.customerName ?? null,
    customerPhone: extras?.customerPhone ?? null,
    customerNotes: extras?.customerNotes ?? null,
    assigneeName: extras?.assigneeName ?? null,
    crewName: extras?.crewName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
    propertyNotes: extras?.propertyNotes ?? null,
    invoiceId: j.invoiceId ?? null,
    blueprintId: j.blueprintId ?? null,
    crewId: j.crewId ?? null,
    serviceId: j.serviceId ?? null,
    planId: j.planId ?? null,
    planName: extras?.planName ?? null,
    cancelReason: j.cancelReason ?? null,
    recurrenceRule: j.recurrenceRule ?? null,
    recurrenceParentId: j.recurrenceParentId ?? null,
    recurrenceIndex: j.recurrenceIndex ?? null,
    isRecurrencePaused: j.isRecurrencePaused ?? false,
    resumeAt: j.resumeAt?.toISOString() ?? null,
    recurrenceCount: j.recurrenceCount ?? 0,
    pendingWeeklyInvoice: j.pendingWeeklyInvoice ?? false,
    recurrenceDescription: rule ? describeRule(rule) : null,
    routeTemplateId: j.routeTemplateId ?? null,
    routeName: extras?.routeName ?? null,
    sequenceOrder: j.sequenceOrder ?? null,
    isOneTimeReschedule: !!j.isOneTimeReschedule,
    originalScheduledDate: j.originalScheduledDate?.toISOString() ?? null,
    smsReminderEnabled: j.smsReminderEnabled ?? false,
    tags: (j.tags as string[]) ?? [],
    skipReasonId: j.skipReasonId ?? null,
    skipNote: j.skipNote ?? null,
    cancellationRequestedAt: j.cancellationRequestedAt?.toISOString() ?? null,
    cancellationReason: j.cancellationReason ?? null,
    cancellationChargeId: (j as any).cancellationChargeId ?? null,
    clockInAt: (j as any).clockInAt ? new Date((j as any).clockInAt).toISOString() : null,
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, assigneeId, startDate, endDate, customerId, crewId, routeTemplateId, propertyId } = req.query as Record<string, string>;

  let where = eq(jobsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(jobsTable.status, status)) as typeof where;
  if (assigneeId) where = and(where, eq(jobsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (crewId) where = and(where, eq(jobsTable.crewId, parseInt(crewId, 10))) as typeof where;
  if (customerId) where = and(where, eq(jobsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (propertyId) where = and(where, eq(jobsTable.propertyId, parseInt(propertyId, 10))) as typeof where;
  if (routeTemplateId) where = and(where, eq(jobsTable.routeTemplateId, parseInt(routeTemplateId, 10))) as typeof where;
  if (startDate) where = and(where, sql`${jobsTable.scheduledAt} >= ${startDate}::timestamptz`) as typeof where;
  if (endDate) where = and(where, sql`${jobsTable.scheduledAt} <= ${endDate}::timestamptz`) as typeof where;

  const rows = await db
    .select({
      job: jobsTable,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      customerNotes: customersTable.notes,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      propertyNotes: propertiesTable.notes,
      crewName: crewsTable.name,
      planName: customerPlansTable.templateName,
      routeName: routeTemplatesTable.name,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .leftJoin(customerPlansTable, eq(jobsTable.planId, customerPlansTable.id))
    .leftJoin(routeTemplatesTable, eq(jobsTable.routeTemplateId, routeTemplatesTable.id))
    .where(where)
    .orderBy(jobsTable.scheduledAt);

  res.json(rows.map(r => formatJob(r.job, { customerName: r.customerName, customerPhone: r.customerPhone, customerNotes: r.customerNotes, assigneeName: r.assigneeName, propertyAddress: r.propertyAddress, propertyNotes: r.propertyNotes, crewName: r.crewName, planName: r.planName, routeName: r.routeName })));
});

// ── Recurring series list ────────────────────────────────────────────────────
router.get("/jobs/series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const callerRole = await getCallerRole(tenantId, userId);

  // Technicians only see series they are directly assigned to.
  const assigneeFilter =
    callerRole === "technician" ? eq(jobsTable.assigneeId, userId) : undefined;

  const roots = await db
    .select({
      job: jobsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      crewName: crewsTable.name,
      planId: customerPlansTable.id,
      planName: customerPlansTable.templateName,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .leftJoin(customerPlansTable, eq(jobsTable.planId, customerPlansTable.id))
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        isNotNull(jobsTable.recurrenceRule),
        isNull(jobsTable.recurrenceParentId),
        assigneeFilter,
      )
    )
    .orderBy(desc(jobsTable.createdAt));

  const rootIds = roots.map(r => r.job.id);

  // Fetch the earliest upcoming scheduled child per root in a single query.
  // This is what users actually see on the calendar — it takes priority over
  // the computed "next ungenerated" date so skip/pre-generation stay consistent.
  const now = new Date();
  const upcomingByRoot = new Map<number, Date>();
  if (rootIds.length > 0) {
    const rows = await db
      .select({
        parentId: jobsTable.recurrenceParentId,
        earliest: min(jobsTable.scheduledAt),
      })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.tenantId, tenantId),
          inArray(jobsTable.recurrenceParentId, rootIds),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, now),
        )
      )
      .groupBy(jobsTable.recurrenceParentId);
    for (const row of rows) {
      if (row.parentId != null && row.earliest != null) {
        upcomingByRoot.set(row.parentId, new Date(row.earliest));
      }
    }
  }

  // For each root: use persisted upcoming child first, fall back to computed
  const series = roots.map(r => {
    const rule = r.job.recurrenceRule as unknown as RecurrenceRule | null;
    let nextScheduledAt: string | null = null;

    const persisted = upcomingByRoot.get(r.job.id);
    if (persisted) {
      nextScheduledAt = persisted.toISOString();
    } else if (rule && !r.job.isRecurrencePaused && r.job.status !== "cancelled") {
      // Fall back to computed next ungenerated date
      const next = nthOccurrenceAfterRoot(rule, r.job.scheduledAt, r.job.recurrenceCount ?? 0);
      nextScheduledAt = next ? next.toISOString() : null;
    }

    return {
      id: r.job.id,
      title: r.job.title,
      status: r.job.status,
      recurrenceRule: rule,
      recurrenceDescription: rule ? describeRule(rule) : "",
      isRecurrencePaused: r.job.isRecurrencePaused,
      resumeAt: r.job.resumeAt?.toISOString() ?? null,
      nextScheduledAt,
      completedCount: r.job.recurrenceCount ?? 0,
      customerName: r.customerName ?? null,
      assigneeName: r.assigneeName ?? null,
      crewName: r.crewName ?? null,
      planId: r.planId ?? null,
      planName: r.planName ?? null,
    };
  });

  res.json(series);
});

router.post("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { title, description, status, priority, customerId, propertyId, assigneeId, crewId, scheduledAt, estimatedDuration, blueprintId, recurrenceRule, smsReminderEnabled } = req.body;

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
    recurrenceRule: recurrenceRule ?? null,
    smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true",
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_created", message: `Job "${title}" created`, entityId: job.id });

  res.status(201).json(formatJob(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ job: jobsTable, customerName: customersTable.name, customerPhone: customersTable.phone, customerNotes: customersTable.notes, assigneeName: usersTable.name, propertyAddress: propertiesTable.address, propertyNotes: propertiesTable.notes, crewName: crewsTable.name, planName: customerPlansTable.templateName, routeName: routeTemplatesTable.name })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .leftJoin(customerPlansTable, eq(jobsTable.planId, customerPlansTable.id))
    .leftJoin(routeTemplatesTable, eq(jobsTable.routeTemplateId, routeTemplatesTable.id))
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(row.job, { customerName: row.customerName, customerPhone: row.customerPhone, customerNotes: row.customerNotes, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress, propertyNotes: row.propertyNotes, crewName: row.crewName, planName: row.planName, routeName: row.routeName }));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { title, description, status, priority, assigneeId, crewId, scheduledAt, estimatedDuration, recurrenceRule, editScope, smsReminderEnabled, holdFromBilling, planId, tags } = req.body;

  // Fetch current job to check if it's a recurring instance
  const [currentJob] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!currentJob) { res.status(404).json({ error: "Not found" }); return; }

  // Validate planId if provided: must exist in tenant and belong to the same customer as the job
  let resolvedPlanId: number | null | undefined = undefined; // undefined = not changing
  if (planId !== undefined) {
    if (planId === null || planId === "" || planId === 0) {
      resolvedPlanId = null;
    } else {
      const numPlanId = parseInt(planId, 10);
      if (isNaN(numPlanId)) {
        res.status(400).json({ error: "planId must be a valid integer" });
        return;
      }
      const [plan] = await db
        .select({ id: customerPlansTable.id, customerId: customerPlansTable.customerId })
        .from(customerPlansTable)
        .where(and(eq(customerPlansTable.id, numPlanId), eq(customerPlansTable.tenantId, tenantId)));
      if (!plan) {
        res.status(400).json({ error: "Service plan not found" });
        return;
      }
      // If the series/job has a customer, the plan must belong to the same customer
      const jobCustomerId = currentJob.customerId;
      if (jobCustomerId != null && plan.customerId !== jobCustomerId) {
        res.status(400).json({ error: "Service plan does not belong to the same customer as this job" });
        return;
      }
      resolvedPlanId = numPlanId;
    }
  }

  // Auto-set clockInAt the first time a job is moved to in_progress
  const shouldSetClockIn =
    status === "in_progress" &&
    currentJob.status !== "in_progress" &&
    !(currentJob as any).clockInAt;

  const baseUpdate: Partial<typeof jobsTable.$inferInsert> = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(priority !== undefined && { priority }),
    ...(shouldSetClockIn && { clockInAt: new Date() } as any),
    ...(assigneeId !== undefined && { assigneeId: assigneeId ? parseInt(assigneeId, 10) : null }),
    ...(crewId !== undefined && { crewId: crewId ? parseInt(crewId, 10) : null }),
    ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
    ...(estimatedDuration !== undefined && { estimatedDuration }),
    ...(smsReminderEnabled !== undefined && { smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true" }),
    ...(holdFromBilling !== undefined && { holdFromBilling: holdFromBilling === true || holdFromBilling === "true" }),
    ...(resolvedPlanId !== undefined && { planId: resolvedPlanId }),
    ...(tags !== undefined && { tags }),
  };

  // Handle "forward" or "all" scope: update the root series template
  if (editScope === "all" || editScope === "forward") {
    const rootId = currentJob.recurrenceParentId ?? id;

    if (recurrenceRule !== undefined) {
      baseUpdate.recurrenceRule = recurrenceRule;
    }

    // Update root
    await db.update(jobsTable)
      .set(baseUpdate)
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));

    if (editScope === "forward") {
      // Update all future instances (status = scheduled, same series)
      const currentIndex = currentJob.recurrenceIndex ?? 0;
      await db.update(jobsTable)
        .set(baseUpdate)
        .where(
          and(
            eq(jobsTable.recurrenceParentId, rootId),
            eq(jobsTable.tenantId, tenantId),
            eq(jobsTable.status, "scheduled"),
            sql`${jobsTable.recurrenceIndex} >= ${currentIndex}`,
          )
        );
    } else {
      // All: update every instance
      await db.update(jobsTable)
        .set(baseUpdate)
        .where(
          and(
            eq(jobsTable.recurrenceParentId, rootId),
            eq(jobsTable.tenantId, tenantId),
          )
        );
    }

    const [updated] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatJob(updated));
    return;
  }

  // Default: update only this occurrence
  if (recurrenceRule !== undefined && !currentJob.recurrenceParentId) {
    baseUpdate.recurrenceRule = recurrenceRule;
  }

  const [updated] = await db.update(jobsTable)
    .set(baseUpdate)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // When planId is changed on a series root, propagate to all existing scheduled children
  // so the series is consistently linked — future generated instances already inherit via recurrenceScheduler.
  if (resolvedPlanId !== undefined && !currentJob.recurrenceParentId && currentJob.recurrenceRule) {
    await db.update(jobsTable)
      .set({ planId: resolvedPlanId })
      .where(
        and(
          eq(jobsTable.recurrenceParentId, id),
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.status, "scheduled"),
        )
      );
  }

  res.json(formatJob(updated));

  // If this is a portal-submitted job and the status changed, notify the customer
  const portalCustomerId = updated.customerId;
  if (
    updated.source === "portal" &&
    status !== undefined &&
    status !== currentJob.status &&
    portalCustomerId !== null
  ) {
    (async () => {
      try {
        const statusLabels: Record<string, string> = {
          pending: "Pending Review",
          scheduled: "Scheduled",
          in_progress: "In Progress",
          completed: "Completed",
          cancelled: "Cancelled",
        };
        const newLabel = statusLabels[status] ?? status;

        // Insert a portal alert so the customer sees it in the Alerts tab
        await db.insert(customerAlertsTable).values({
          tenantId,
          customerId: portalCustomerId,
          jobId: updated.id,
          type: "status_update",
          message: `Your service request "${updated.title}" has been updated to: ${newLabel}.`,
          status: "pending",
        }).catch(() => { /* best-effort */ });

        // Also send an email notification
        const [tenantRow, customerRow] = await Promise.all([
          db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
          db.select({ name: customersTable.name, email: customersTable.email })
            .from(customersTable)
            .where(eq(customersTable.id, portalCustomerId))
            .limit(1),
        ]);
        const tenant = tenantRow[0];
        const customer = customerRow[0];
        if (!customer?.email) return;

        const emailProviderConfig: EmailProviderConfig = {
          provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
          config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };
        const companyName = tenant?.name ?? "Your Service Provider";

        const subject = `Service Request Update — ${updated.title}`;
        const body = [
          `Hi ${customer.name ?? "there"},`,
          "",
          `Your service request has been updated.`,
          "",
          `Request: ${updated.title}`,
          `New Status: ${newLabel}`,
          "",
          status === "scheduled" && updated.scheduledAt
            ? `Scheduled for: ${updated.scheduledAt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`
            : null,
          status === "completed"
            ? "Our team has completed the work. Thank you for choosing us!"
            : "You'll receive another update when the status changes.",
          "",
          "If you have any questions, please contact us.",
          "",
          `Thank you,`,
          companyName,
        ].filter((l) => l !== null).join("\n");

        await sendEmail(emailProviderConfig, customer.email, subject, body);
      } catch (err) {
        // fire-and-forget — never breaks the response already sent
      }
    })();
  }
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  // Block deletion if the job has linked chemical application records.
  // Deleting would SET NULL the job_id and permanently sever the compliance audit trail.
  const [chemCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chemicalApplicationsTable)
    .where(and(eq(chemicalApplicationsTable.jobId, id), eq(chemicalApplicationsTable.tenantId, tenantId)));

  const count = chemCount?.count ?? 0;
  if (count > 0) {
    res.status(409).json({
      error: "Cannot delete job with chemical application records",
      message: `This job has ${count} chemical application record${count === 1 ? "" : "s"} linked to it. Deleting the job would permanently remove the job association from these compliance records. Please reassign or remove the chemical application records before deleting this job.`,
      chemicalApplicationCount: count,
    });
    return;
  }

  await db.delete(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  // Fetch current description so we can append the completion date
  const [current] = await db
    .select({ description: jobsTable.description })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const existing = current?.description ?? '';
  const newDescription = existing
    ? `${existing}\n\nService completed: ${dateStr}`
    : `Service completed: ${dateStr}`;

  const [updated] = await db.update(jobsTable)
    .set({ status: "completed", completedAt: now, description: newDescription })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_completed", message: `Job "${updated.title}" completed`, entityId: id });

  // Compute and store rainfast / re-entry timer expiry for any chemical applications on this job.
  // Awaited synchronously — timers must be persisted before this endpoint returns so the portal
  // shows safety notices immediately after completion. A failure is logged but does not block the
  // completion response; the job is already marked done and the customer safety notice is the
  // priority concern.
  try {
    const apps = await db
      .select({ id: chemicalApplicationsTable.id, productId: chemicalApplicationsTable.productId, mixtureId: chemicalApplicationsTable.mixtureId })
      .from(chemicalApplicationsTable)
      .where(and(eq(chemicalApplicationsTable.jobId, id), eq(chemicalApplicationsTable.tenantId, tenantId)));

    for (const app of apps) {
      let maxRainfastHours: number | null = null;
      let maxRei: number | null = null;

      if (app.productId) {
        const [product] = await db
          .select({ rainfastHours: chemicalProductsTable.rainfastHours, rei: chemicalProductsTable.rei })
          .from(chemicalProductsTable)
          .where(and(eq(chemicalProductsTable.id, app.productId), eq(chemicalProductsTable.tenantId, tenantId)));
        maxRainfastHours = (product as any)?.rainfastHours ?? null;
        maxRei = product?.rei ?? null;
      } else if (app.mixtureId) {
        const items = await db
          .select({ rainfastHours: chemicalProductsTable.rainfastHours, rei: chemicalProductsTable.rei })
          .from(chemicalMixtureItemsTable)
          .leftJoin(chemicalProductsTable, and(
            eq(chemicalMixtureItemsTable.productId, chemicalProductsTable.id),
            eq(chemicalProductsTable.tenantId, tenantId),
          ))
          .where(eq(chemicalMixtureItemsTable.mixtureId, app.mixtureId));
        for (const item of items) {
          const rf = (item as any).rainfastHours as number | null;
          const ri = item.rei;
          if (rf != null && (maxRainfastHours === null || rf > maxRainfastHours)) maxRainfastHours = rf;
          if (ri != null && (maxRei === null || ri > maxRei)) maxRei = ri;
        }
      }

      const rainfastUntil = maxRainfastHours != null
        ? new Date(now.getTime() + maxRainfastHours * 3600 * 1000)
        : null;
      const reentryUntil = maxRei != null
        ? new Date(now.getTime() + maxRei * 3600 * 1000)
        : null;

      if (rainfastUntil !== null || reentryUntil !== null) {
        await db.update(chemicalApplicationsTable)
          .set({
            ...(rainfastUntil !== null && { rainfastUntil } as any),
            ...(reentryUntil !== null && { reentryUntil } as any),
          })
          .where(eq(chemicalApplicationsTable.id, app.id));
      }
    }
  } catch (err) {
    logger.warn({ err, jobId: id }, "Failed to compute chemical timer expiry on job completion");
  }

  // ── Rainfast weather alert ─────────────────────────────────────────────────
  // After the rainfast timers are persisted, asynchronously check if rain is
  // forecast before any rainfastUntil window and create an internal task if so.
  // Runs fire-and-forget so it never blocks the completion response.
  void (async () => {
    try {
      // Only check if the job has a property with coordinates
      if (!updated.propertyId) return;
      const [property] = await db
        .select({ lat: propertiesTable.lat, lng: propertiesTable.lng })
        .from(propertiesTable)
        .where(and(eq(propertiesTable.id, updated.propertyId), eq(propertiesTable.tenantId, tenantId)));
      if (!property?.lat || !property?.lng) return;

      // Fetch all chemical applications that have a rainfastUntil set for this job
      const appsWithRainfast = await db
        .select({
          id: chemicalApplicationsTable.id,
          rainfastUntil: chemicalApplicationsTable.rainfastUntil,
          productName: chemicalApplicationsTable.productName,
          mixtureName: chemicalApplicationsTable.mixtureName,
        })
        .from(chemicalApplicationsTable)
        .where(and(
          eq(chemicalApplicationsTable.jobId, id),
          eq(chemicalApplicationsTable.tenantId, tenantId),
          isNotNull(chemicalApplicationsTable.rainfastUntil),
        ));
      if (appsWithRainfast.length === 0) return;

      // Read the tenant's rain threshold (default 40%)
      const [tenantSettings] = await db
        .select({ rainfastRainThresholdPct: tenantsTable.rainfastRainThresholdPct })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId));
      const thresholdPct = tenantSettings?.rainfastRainThresholdPct ?? 40;

      // Find the widest rainfastUntil window (latest expiry) across all applications
      let latestWindow: Date | null = null;
      for (const app of appsWithRainfast) {
        if (app.rainfastUntil && (latestWindow === null || app.rainfastUntil > latestWindow)) {
          latestWindow = app.rainfastUntil;
        }
      }
      if (!latestWindow) return;

      // Query weather for the latest window
      const rainForecast = await checkRainBeforeWindow(
        property.lat,
        property.lng,
        latestWindow,
        thresholdPct,
      );
      if (!rainForecast) return;

      // Build a description listing the affected chemicals and their windows
      const chemLines = appsWithRainfast.map(app => {
        const name = app.productName ?? app.mixtureName ?? "Unknown chemical";
        const until = app.rainfastUntil ? new Date(app.rainfastUntil).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }) : "—";
        return `• ${name} — rainfast window closes ${until}`;
      });
      const forecastTimeStr = new Date(rainForecast.forecastTime).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
      });
      const description = [
        `Rain (${rainForecast.probability}% probability) is forecast around ${forecastTimeStr} — before the rainfast window closes on job #${id} "${updated.title}".`,
        ``,
        `Affected applications:`,
        ...chemLines,
        ``,
        `Consider re-applying affected chemicals after the window has passed if significant rainfall occurs.`,
      ].join("\n");

      // Create an internal task for admin/office staff
      const [task] = await db.insert(internalTasksTable).values({
        tenantId,
        title: `⚠️ Rain forecast before rainfast window — Job #${id} "${updated.title}"`,
        description,
        taskType: "custom",
        createdById: userId,
        assignedToRole: "admin_office",
        priority: "high",
        status: "open",
        contextType: "job",
        contextId: id,
      }).returning({ id: internalTasksTable.id });

      // Notify all admin/office users so they see it in their notification bell
      const adminUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.tenantId, tenantId),
          sql`${usersTable.role} IN ('owner', 'admin', 'admin_office', 'manager')`,
        ));
      if (adminUsers.length > 0 && task) {
        await db.insert(taskNotificationsTable).values(
          adminUsers.map(u => ({
            tenantId,
            recipientUserId: u.id,
            taskId: task.id,
            type: "assigned",
            message: `⚠️ Rain (${rainForecast.probability}%) forecast before rainfast window closes — Job #${id} "${updated.title}"`,
          }))
        );
      }

      logger.info({ jobId: id, forecastTime: rainForecast.forecastTime, probability: rainForecast.probability }, "Rainfast weather alert created");
    } catch (err) {
      logger.warn({ err, jobId: id }, "Rainfast weather check failed — no alert created");
    }
  })();

  // Archive any blueprint tied to this job (either direction of the link) so it drops out of the
  // main Blueprints list but stays visible/reusable from the property page.
  await db.update(blueprintsTable)
    .set({ isArchived: true, archivedAt: new Date() })
    .where(and(eq(blueprintsTable.tenantId, tenantId), or(eq(blueprintsTable.jobId, id), eq(blueprintsTable.id, updated.blueprintId ?? -1))));

  // If this job was converted from an estimate with "Invoice after job" chosen, auto-create a draft invoice now.
  // On success → return early. On failure → flag the job for the weekly billing sweep so it is never permanently unbilled.
  if ((updated as any).invoiceAfterJob && (updated as any).estimateId && updated.customerId && !updated.invoiceId) {
    let deferredInvoiceCreated = false;
    try {
      const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      const taxRate = tenant?.taxRate ?? 0;
      const lineItems = (updated.lineItems as unknown[]) ?? [];
      const subtotal = updated.totalAmount ?? 0;
      const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = subtotal + tax;
      const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

      await db.transaction(async tx => {
        const [invoice] = await tx.insert(invoicesTable).values({
          tenantId,
          invoiceNumber: invoiceNum,
          customerId: updated.customerId!,
          jobId: updated.id,
          status: "draft",  // Always draft — staff reviews before sending
          subtotal,
          tax,
          total,
          lineItems,
        }).returning();
        await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, id));
        // Activity log inside the same transaction for full atomicity
        await tx.insert(activityLogTable).values({ tenantId, userId, type: "invoice_created", message: `Draft invoice ${invoiceNum} auto-created on estimate-sourced job completion`, entityId: invoice.id });
      });
      deferredInvoiceCreated = true;
    } catch (err) {
      // Guarantee billing: flag this job for the weekly billing sweep regardless of whether
      // the customer has autoInvoiceOnCompletion enabled. Without this, an invoice failure for
      // a customer without autoInvoiceOnCompletion would leave them permanently unbilled.
      console.error({ err, jobId: id }, "Deferred invoice creation failed — flagging job for weekly billing sweep");
      try {
        await db.update(jobsTable).set({ pendingWeeklyInvoice: true }).where(eq(jobsTable.id, id));
      } catch (fallbackErr) {
        console.error({ fallbackErr, jobId: id }, "Failed to set pendingWeeklyInvoice fallback — manual billing review required");
      }
    }
    // Return the job whether or not invoice creation succeeded;
    // pendingWeeklyInvoice=true in the fallback branch guarantees it will be billed
    res.json(formatJob(deferredInvoiceCreated ? updated : { ...updated, pendingWeeklyInvoice: true }));
    return;
  }

  // Auto-invoice on completion if enabled for this customer
  if (updated.customerId) {
    const [customer] = await db
      .select({ autoInvoiceOnCompletion: customersTable.autoInvoiceOnCompletion, email: customersTable.email })
      .from(customersTable)
      .where(eq(customersTable.id, updated.customerId));

    if (customer?.autoInvoiceOnCompletion && !updated.invoiceId) {
      const [tenantCadence] = await db.select({ nonRecurringInvoiceCadence: tenantsTable.nonRecurringInvoiceCadence }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      if ((tenantCadence?.nonRecurringInvoiceCadence ?? "immediate") === "weekly") {
        // Weekly cadence: flag for the weekly batch sweep instead of invoicing immediately.
        await db.update(jobsTable).set({ pendingWeeklyInvoice: true }).where(eq(jobsTable.id, id));
        res.json(formatJob({ ...updated, pendingWeeklyInvoice: true }));
        return;
      }
      try {
        const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
        const taxRate = tenant?.taxRate ?? 0;
        const lineItems = (updated.lineItems as unknown[]) ?? [];
        const subtotal = updated.totalAmount ?? 0;
        const tax = subtotal * (taxRate / 100);
        const total = subtotal + tax;
        const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

        let invoiceId!: number;
        await db.transaction(async tx => {
          const [invoice] = await tx.insert(invoicesTable).values({
            tenantId,
            invoiceNumber: invoiceNum,
            customerId: updated.customerId!,
            jobId: updated.id,
            status: customer.email ? "sent" : "draft",
            publicToken: customer.email ? crypto.randomBytes(32).toString("hex") : null,
            subtotal,
            tax,
            total,
            lineItems,
          }).returning();
          invoiceId = invoice.id;
          await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, id));
        });

        await db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_sent", message: `Auto-invoice ${invoiceNum} created on job completion`, entityId: invoiceId });

        if (customer.email) {
          await enqueueInvoiceEmail(tenantId, invoiceId);
        }
      } catch (err) {
        // Non-fatal: log but don't fail the job completion response
        console.error("Auto-invoice creation failed:", err);
        // Write an activity log entry so staff can see the failure and follow up
        await db.insert(activityLogTable).values({
          tenantId,
          userId,
          type: "auto_invoice_failed",
          message: `Auto-invoice creation failed on job completion: ${err instanceof Error ? err.message : String(err)}`,
          entityId: id,
        }).catch(() => { /* best-effort */ });
      }
    }
  }

  res.json(formatJob(updated));
});

// ── Skip next occurrence ─────────────────────────────────────────────────────
router.post("/jobs/:id/skip-next", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { reasonId, note } = req.body as { reasonId?: number; note?: string };

  // Resolve root
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  // Technicians may only skip series they are directly assigned to.
  const callerRole = await getCallerRole(tenantId, userId);
  if (callerRole === "technician") {
    const [root] = await db
      .select({ assigneeId: jobsTable.assigneeId })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
    if (!root || root.assigneeId !== userId) {
      res.status(403).json({ error: "Not authorized to skip this series" });
      return;
    }
  }

  // Validate skip reason if provided
  let skipReason: typeof skipReasonsTable.$inferSelect | null = null;
  if (reasonId) {
    const [r] = await db.select().from(skipReasonsTable)
      .where(and(eq(skipReasonsTable.id, reasonId), eq(skipReasonsTable.tenantId, tenantId)));
    if (!r) { res.status(400).json({ error: "Skip reason not found" }); return; }
    skipReason = r;
  }

  // Skip semantics (exactly one occurrence, regardless of pre-generation state):
  //
  //   Case A — scheduler has already materialized the next child:
  //     recurrenceCount was already incremented when the child was created.
  //     Cancel that child only. Do NOT increment count again (would double-skip).
  //
  //   Case B — no child materialized yet:
  //     Increment recurrenceCount so the scheduler skips the next computed slot.
  let skippedJobId: number | null = null;
  await db.transaction(async tx => {
    const [nextChild] = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.recurrenceParentId, rootId),
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, new Date()),
        )
      )
      .orderBy(asc(jobsTable.scheduledAt))
      .limit(1);

    if (nextChild) {
      skippedJobId = nextChild.id;
      await tx.update(jobsTable)
        .set({
          status: "cancelled",
          ...(reasonId && { skipReasonId: reasonId }),
          ...(note && { skipNote: note }),
        })
        .where(and(eq(jobsTable.id, nextChild.id), eq(jobsTable.tenantId, tenantId)));
    } else {
      await tx.update(jobsTable)
        .set({
          recurrenceCount: sql`${jobsTable.recurrenceCount} + 1`,
          ...(reasonId && { skipReasonId: reasonId }),
          ...(note && { skipNote: note }),
        })
        .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
    }
  });

  const [updated] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));

  // ── Post-skip side-effects (fire-and-forget) ──────────────────────────────
  if (skipReason) {
    (async () => {
      try {
        const reasonLabel = skipReason!.label;
        const jobTitle = updated.title;
        const customerId = updated.customerId;
        const propertyId = updated.propertyId;

        // 1. Notify all office/admin staff in-app
        const officeUsers = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.tenantId, tenantId),
            sql`${usersTable.role} IN ('company_owner', 'office_manager', 'department_manager')`,
            eq(usersTable.isActive, true),
          ));

        if (officeUsers.length > 0) {
          const actorRow = await db.select({ name: usersTable.name }).from(usersTable)
            .where(eq(usersTable.id, userId)).limit(1);
          const actorName = actorRow[0]?.name ?? "Staff";
          const message = `"${jobTitle}" was skipped — Reason: ${reasonLabel}${note ? ` — "${note}"` : ""}. Skipped by ${actorName}.`;
          await db.insert(taskNotificationsTable).values(
            officeUsers.map(u => ({
              tenantId,
              recipientUserId: u.id,
              taskId: null,
              type: "job_skipped",
              message,
              linkPath: `/schedule`,
              isRead: false,
            }))
          );
        }

        // 2. Execute configured action
        const actionConfig = (skipReason!.actionConfig ?? {}) as Record<string, string>;

        if (skipReason!.action === "notify_customer" && customerId) {
          const [customer, tenant] = await Promise.all([
            db.select({ phone: customersTable.phone, name: customersTable.name, smsOptOut: customersTable.smsOptOut })
              .from(customersTable).where(eq(customersTable.id, customerId)).limit(1),
            db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
          ]);
          const c = customer[0];
          const t = tenant[0];
          if (c && !c.smsOptOut && c.phone && t) {
            const firstName = c.name?.split(" ")[0] ?? "there";
            const defaultMsg = `Hi ${firstName}, your upcoming service "${jobTitle}" has been skipped — Reason: ${reasonLabel}. We'll be in touch to reschedule if needed.`;
            const msg = actionConfig["messageTemplate"]
              ? actionConfig["messageTemplate"].replace("{firstName}", firstName).replace("{jobTitle}", jobTitle).replace("{reason}", reasonLabel)
              : defaultMsg;
            const smsConfig: SmsProviderConfig = {
              platform: (t.phonePlatform as SmsProviderConfig["platform"]) ?? null,
              config: (t.phonePlatformConfig as Record<string, string>) ?? {},
              fromNumber: t.mainPhoneNumber ?? null,
            };
            await sendSms(smsConfig, c.phone, msg).catch(() => {});
          }
        }

        if (skipReason!.action === "flag_property" && propertyId) {
          const defaultNote = `Job "${jobTitle}" was skipped — Reason: ${reasonLabel}`;
          const flagNote = actionConfig["note"] || defaultNote;
          if (customerId) {
            await db.insert(customerAlertsTable).values({
              tenantId,
              customerId,
              jobId: skippedJobId ?? updated.id,
              type: "skip_flag",
              message: flagNote,
              status: "pending",
            }).catch(() => {});
          }
        }

        if (skipReason!.action === "create_task") {
          const defaultTitle = `Follow up: "${jobTitle}" was skipped (${reasonLabel})`;
          const taskTitle = actionConfig["title"] || defaultTitle;
          const priority = (actionConfig["priority"] as "low" | "normal" | "high") ?? "normal";
          await db.insert(internalTasksTable).values({
            tenantId,
            title: taskTitle,
            description: note || `Job was skipped with reason: ${reasonLabel}`,
            taskType: "custom",
            createdById: userId,
            assignedToRole: "admin_office",
            priority,
            status: "open",
            contextType: "job",
            contextId: skippedJobId ?? updated.id,
          }).catch(() => {});
        }
      } catch (err) {
        // fire-and-forget — never breaks the response
      }
    })();
  }
});

// ── Pause / resume series ────────────────────────────────────────────────────
router.patch("/jobs/:id/pause-series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { paused, resumeAt } = req.body as { paused?: boolean; resumeAt?: string | null };

  if (typeof paused !== "boolean") {
    res.status(400).json({ error: "paused (boolean) is required" });
    return;
  }
  if (resumeAt !== undefined && resumeAt !== null && isNaN(Date.parse(resumeAt))) {
    res.status(400).json({ error: "resumeAt must be a valid ISO date" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  const [updated] = await db.update(jobsTable)
    .set({
      isRecurrencePaused: paused,
      // Off-season pause: only persist resumeAt while pausing; resuming manually clears it.
      resumeAt: paused ? (resumeAt ? new Date(resumeAt) : null) : null,
    })
    .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));
});

// ── Cancel series ────────────────────────────────────────────────────────────
router.delete("/jobs/:id/cancel-series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const scope = (req.query.scope as string) ?? "forward";

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  if (scope === "all") {
    // Cancel root + all children
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(and(eq(jobsTable.recurrenceParentId, rootId), eq(jobsTable.tenantId, tenantId)));
  } else {
    // Cancel only future (scheduled) instances and pause the root
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(jobsTable.recurrenceParentId, rootId),
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.status, "scheduled"),
        )
      );
    await db.update(jobsTable)
      .set({ isRecurrencePaused: true })
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
  }

  res.sendStatus(204);
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

// ---------------------------------------------------------------------------
// POST /jobs/:id/approve-cancellation — staff approves a portal cancel request
// ---------------------------------------------------------------------------
router.post("/jobs/:id/approve-cancellation", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  // Only office/admin staff may approve cancellations (and trigger off-session charges)
  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required to approve cancellations" });
    return;
  }

  // ── Atomic claim: cancel the job in one conditional UPDATE ──────────────────
  // WHERE includes `cancellationRequestedAt IS NOT NULL` so only one concurrent
  // request can win; any racing approver gets 0 rows and 409s.
  // This must happen BEFORE any invoice or Stripe work to prevent double-charging.
  const [claimedJob] = await db
    .update(jobsTable)
    .set({ status: "cancelled", cancellationRequestedAt: null } as any)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.tenantId, tenantId),
        isNotNull((jobsTable as any).cancellationRequestedAt),
      ),
    )
    .returning();

  if (!claimedJob) {
    res.status(409).json({ error: "No pending cancellation request on this job, or it was already processed" });
    return;
  }

  // ── Auto-charge cancellation fee when approving within-24h cancellations ──
  // Charging at approval time (not at request time) ensures denied requests
  // never leave the customer charged.
  const hoursUntilJob = claimedJob.scheduledAt
    ? (new Date(claimedJob.scheduledAt).getTime() - Date.now()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursUntilJob < 24) {
    try {
      const [[tenant], [customerRow]] = await Promise.all([
        db.select({
          cancellationFeeEnabled: (tenantsTable as any).cancellationFeeEnabled,
          cancellationFeeAmount: (tenantsTable as any).cancellationFeeAmount,
        }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
        db.select({
          stripeCustomerId: customersTable.stripeCustomerId,
          stripeDefaultPaymentMethodId: customersTable.stripeDefaultPaymentMethodId,
        }).from(customersTable).where(eq(customersTable.id, claimedJob.customerId!)).limit(1),
      ]);

      if (tenant?.cancellationFeeEnabled && (tenant.cancellationFeeAmount ?? 0) > 0) {
        const feeAmount = tenant.cancellationFeeAmount as number;
        const invoiceNumber = `CANC-${id}-${Date.now().toString(36).toUpperCase()}`;
        const lineItems = [{ description: `Cancellation fee — Job #${id}`, quantity: 1, unitPrice: feeAmount, total: feeAmount }];

        // Pre-create the invoice as "draft" before calling Stripe so a durable
        // local record always exists, even if the process dies after Stripe
        // collects the payment but before the DB update completes.
        const [chargeInvoice] = await db.insert(invoicesTable).values({
          tenantId,
          invoiceNumber,
          customerId: claimedJob.customerId!,
          status: "draft",
          subtotal: feeAmount,
          tax: 0,
          total: feeAmount,
          lineItems,
          notes: `Auto-generated cancellation fee for Job #${id}`,
        } as any).returning({ id: invoicesTable.id });

        if (chargeInvoice?.id) {
          // Idempotency key scoped to the invoice ID — each approval attempt
          // after a remove/deny/re-cancel cycle gets its own Stripe PI.
          const stripeIdempotencyKey = `cancelFee-${tenantId}-${id}-${chargeInvoice.id}`;

          // Persist key in notes + link job (parallel writes)
          await Promise.all([
            db.update(invoicesTable)
              .set({ notes: `Auto-generated cancellation fee for Job #${id}. Stripe idempotency key: ${stripeIdempotencyKey}` } as any)
              .where(eq(invoicesTable.id, chargeInvoice.id)),
            db.update(jobsTable)
              .set({ cancellationChargeId: chargeInvoice.id } as any)
              .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))),
          ]);

          const stripe = getStripeClient();
          if (stripe && customerRow?.stripeCustomerId && customerRow?.stripeDefaultPaymentMethodId) {
            try {
              const pi = await stripe.paymentIntents.create(
                {
                  amount: Math.round(feeAmount * 100),
                  currency: "usd",
                  customer: customerRow.stripeCustomerId,
                  payment_method: customerRow.stripeDefaultPaymentMethodId,
                  off_session: true,
                  confirm: true,
                  description: `Cancellation fee — Job #${id}`,
                  metadata: { jobId: String(id), tenantId: String(tenantId), invoiceId: String(chargeInvoice.id) },
                },
                { idempotencyKey: stripeIdempotencyKey },
              );

              // Always store the PI URL immediately — success or card decline —
              // so the delete endpoint can always resolve the payment state.
              const piUrl = `https://dashboard.stripe.com/payments/${pi.id}`;
              const invoiceUpdate: any = { stripePaymentUrl: piUrl };
              if (pi.status === "succeeded") {
                invoiceUpdate.status = "paid";
                invoiceUpdate.paidAt = new Date();
              } else {
                logger.warn({ piStatus: pi.status, jobId: id }, "Stripe PI not immediately succeeded — invoice left as draft");
              }
              await db.update(invoicesTable).set(invoiceUpdate).where(eq(invoicesTable.id, chargeInvoice.id));
            } catch (stripeErr: any) {
              // Card errors surface a failed PI object inside the error; store
              // its URL so the delete endpoint knows no refund is needed.
              const failedPi: any = stripeErr?.payment_intent;
              if (failedPi?.id) {
                await db.update(invoicesTable)
                  .set({ stripePaymentUrl: `https://dashboard.stripe.com/payments/${failedPi.id}` } as any)
                  .where(eq(invoicesTable.id, chargeInvoice.id));
                logger.warn({ code: stripeErr.code, piId: failedPi.id, jobId: id }, "Stripe card declined — draft invoice retained for manual collection");
              } else {
                // Network/server error — no PI ID yet; deletion must use the
                // Stripe metadata search to reconcile before removing.
                logger.error(
                  { err: stripeErr, jobId: id, stripeIdempotencyKey, invoiceId: chargeInvoice.id },
                  "Stripe network error during cancellation charge — PI state uncertain. " +
                  "Draft invoice left as reconciliation record (search Stripe by invoiceId metadata).",
                );
              }
            }
          }
          // Stripe not configured or no card on file → invoice stays draft for manual collection.
        }
      }
    } catch (chargeErr) {
      logger.error({ err: chargeErr, jobId: id }, "Failed to create cancellation fee charge during approval");
      // Charge failure is non-fatal; job is already cancelled — staff can handle the fee manually.
    }
  }

  // Job was atomically cancelled in the claim step above; return the claimed record.
  res.json(formatJob(claimedJob));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/deny-cancellation — staff denies a portal cancel request
// ---------------------------------------------------------------------------
router.post("/jobs/:id/deny-cancellation", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required to deny cancellations" });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!(job as any).cancellationRequestedAt) {
    res.status(409).json({ error: "No pending cancellation request on this job" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      cancellationRequestedAt: null,
      cancellationReason: null,
    } as any)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// DELETE /jobs/:id/cancellation-charge — remove an auto-created cancellation fee.
// Requires office/admin role.
// - Draft invoices: deleted atomically with the job link.
// - Paid invoices: a Stripe refund is issued first; the invoice is then voided
//   (not deleted) to preserve the accounting audit trail.
// ---------------------------------------------------------------------------
router.delete("/jobs/:id/cancellation-charge", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required" });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .limit(1);

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const chargeId = (job as any).cancellationChargeId as number | null;
  if (!chargeId) { res.status(409).json({ error: "No cancellation charge linked to this job" }); return; }

  // Fetch the linked invoice to determine how to remove it
  const [chargeInvoice] = await db
    .select({ id: invoicesTable.id, status: invoicesTable.status, stripePaymentUrl: invoicesTable.stripePaymentUrl })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, chargeId), eq(invoicesTable.tenantId, tenantId)))
    .limit(1);

  if (!chargeInvoice) {
    // Stale link — invoice already gone; just clear the reference
    const [updated] = await db.update(jobsTable).set({ cancellationChargeId: null } as any)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
      .returning();
    res.json(formatJob(updated));
    return;
  }

  // Helper: extract a Stripe PaymentIntent ID from the stored dashboard URL
  const extractPiId = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const piId = url.split("/").pop();
    return piId?.startsWith("pi_") ? piId : null;
  };

  const stripe = getStripeClient();
  const piId = extractPiId(chargeInvoice.stripePaymentUrl);

  if (chargeInvoice.status === "paid") {
    // Paid invoice — Stripe already collected the fee.
    // Require a verifiable PI ID to issue the refund; refuse if provenance is unclear.
    if (!piId) {
      res.status(409).json({
        error: "Cannot automatically refund: no Stripe PaymentIntent ID is recorded for this charge. " +
               "Please issue the refund manually in the Stripe dashboard, then contact support to void this invoice.",
      });
      return;
    }
    const refundIdempotencyKey = `refund-cancel-charge-${chargeId}`;
    try {
      await stripe!.refunds.create({ payment_intent: piId }, { idempotencyKey: refundIdempotencyKey });
    } catch (refundErr: unknown) {
      logger.error({ err: refundErr, invoiceId: chargeId, piId, refundIdempotencyKey }, "Stripe refund failed during cancellation charge removal");
      res.status(502).json({ error: "Failed to issue Stripe refund. Please process the refund in the Stripe dashboard first, then try again." });
      return;
    }
    // Void the invoice (preserve audit trail — never delete a paid record)
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx.update(jobsTable).set({ cancellationChargeId: null } as any)
        .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
        .returning();
      await tx.update(invoicesTable).set({ status: "void" } as any)
        .where(and(eq(invoicesTable.id, chargeId), eq(invoicesTable.tenantId, tenantId)));
      return rows;
    });
    res.json(formatJob(updated));
    return;
  }

  // Draft invoice — determine whether Stripe collected a payment before deleting.
  // The charge flow stores the PI URL on every Stripe response (success or card decline).
  // If a PI URL is present, query Stripe to check the authoritative current status.
  // ── Draft invoice with a stored PI URL: verify PI status with Stripe ───────
  // The charge flow records the PI URL on every Stripe response (success or
  // card decline), so a stored URL means Stripe definitely created a PI.
  // When no URL is stored, Stripe either wasn't called, the call failed before
  // creating a PI, or a network error occurred — use a metadata search to
  // reconcile in that last case.
  // Safe-to-delete terminal states: only `canceled` and `requires_payment_method`
  // (definitive card/auth failure after a confirm attempt).  All other
  // non-succeeded states (processing, requires_capture, requires_action,
  // requires_confirmation) are uncertain or still collectible — fail closed.
  const TERMINAL_FAILED = new Set(["canceled", "requires_payment_method"]);

  if (piId) {
    if (!stripe) {
      // PI URL stored but Stripe not configured — cannot verify; fail closed.
      res.status(502).json({
        error: "Stripe is not configured. Cannot verify payment state. Please check the Stripe dashboard and refund manually if needed, then contact support.",
      });
      return;
    }
    let piStatus: string;
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      piStatus = pi.status;
    } catch (retrieveErr: unknown) {
      logger.error({ err: retrieveErr, piId, invoiceId: chargeId }, "Failed to retrieve Stripe PI during cancellation charge removal");
      res.status(502).json({ error: "Could not verify Stripe payment status. Please check the Stripe dashboard and try again." });
      return;
    }

    if (piStatus === "succeeded") {
      // PI collected but status wasn't persisted locally (process crashed between
      // Stripe response and DB update).  Issue a refund then void.
      const refundIdempotencyKey = `refund-cancel-charge-${chargeId}`;
      try {
        await stripe.refunds.create({ payment_intent: piId }, { idempotencyKey: refundIdempotencyKey });
      } catch (refundErr: unknown) {
        logger.error({ err: refundErr, piId, invoiceId: chargeId }, "Stripe refund failed for succeeded PI on draft invoice");
        res.status(502).json({ error: "Failed to issue Stripe refund. Please refund in the Stripe dashboard first, then try again." });
        return;
      }
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx.update(jobsTable).set({ cancellationChargeId: null } as any)
          .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
          .returning();
        await tx.update(invoicesTable).set({ status: "void" } as any)
          .where(and(eq(invoicesTable.id, chargeId), eq(invoicesTable.tenantId, tenantId)));
        return rows;
      });
      res.json(formatJob(updated));
      return;
    }

    if (!TERMINAL_FAILED.has(piStatus)) {
      // Uncertain or still-collectible state (processing, requires_capture, etc.)
      // Fail closed — retain the invoice and link until the state resolves.
      logger.warn({ piStatus, piId, invoiceId: chargeId }, "Cancellation charge removal blocked: PI not in terminal state");
      res.status(409).json({
        error: `Stripe payment is in a non-terminal state (${piStatus}). Wait for Stripe to finalize the payment, then try again.`,
      });
      return;
    }
    // TERMINAL_FAILED — charge definitively failed; safe to delete invoice below.

  } else if (stripe) {
    // No PI URL stored — network-error case where Stripe may or may not have
    // created a PI.  Search by invoiceId metadata to reconcile.
    try {
      const search = await stripe.paymentIntents.search({
        query: `metadata['invoiceId']:'${chargeId}'`,
        limit: 1,
      });
      const unclearedPi = search.data.find(p => !TERMINAL_FAILED.has(p.status));
      if (unclearedPi) {
        if (unclearedPi.status === "succeeded") {
          const refundIdempotencyKey = `refund-cancel-charge-${chargeId}`;
          try {
            await stripe.refunds.create({ payment_intent: unclearedPi.id }, { idempotencyKey: refundIdempotencyKey });
          } catch (refundErr: unknown) {
            logger.error({ err: refundErr, piId: unclearedPi.id, invoiceId: chargeId }, "Stripe refund failed during metadata-reconciled cancellation charge removal");
            res.status(502).json({ error: "Found an unrefunded Stripe charge. Please refund it in the Stripe dashboard first, then try again." });
            return;
          }
          const [updated] = await db.transaction(async (tx) => {
            const rows = await tx.update(jobsTable).set({ cancellationChargeId: null } as any)
              .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
              .returning();
            await tx.update(invoicesTable).set({ status: "void" } as any)
              .where(and(eq(invoicesTable.id, chargeId), eq(invoicesTable.tenantId, tenantId)));
            return rows;
          });
          res.json(formatJob(updated));
          return;
        }
        // Non-succeeded, non-terminal state — fail closed.
        res.status(409).json({
          error: `Stripe payment is in a non-terminal state (${unclearedPi.status}). Wait for Stripe to finalize, then try again.`,
        });
        return;
      }
      // All found PIs are in terminal-failed states, or none found — safe to delete.
    } catch (searchErr: unknown) {
      // Stripe search failed — cannot confirm payment state; fail closed.
      logger.error({ err: searchErr, invoiceId: chargeId }, "Stripe metadata search failed during cancellation charge removal — cannot confirm payment state");
      res.status(502).json({
        error:
          "Could not verify Stripe payment state. Please check the Stripe dashboard for any charge against this job " +
          "(search by invoiceId metadata). If a payment exists, refund it manually, then try removing the charge again.",
      });
      return;
    }
  }
  // Stripe unavailable AND no PI URL stored → Stripe was never configured when
  // the charge was created; invoice was draft for manual collection → safe to delete.

  // No confirmed Stripe payment — delete the draft invoice atomically
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(jobsTable).set({ cancellationChargeId: null } as any)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
      .returning();
    await tx.delete(invoicesTable)
      .where(and(eq(invoicesTable.id, chargeId), eq(invoicesTable.tenantId, tenantId)));
    return rows;
  });
  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/resend-reminder — manually re-send a failed reminder
// ---------------------------------------------------------------------------
router.post("/jobs/:id/resend-reminder", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required" });
    return;
  }

  const { reminderType } = req.body as { reminderType?: string };
  if (reminderType !== "7d" && reminderType !== "24h") {
    res.status(400).json({ error: "reminderType must be '7d' or '24h'" });
    return;
  }

  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const result = await resendReminderForJob(tenantId, id, reminderType);
  res.json(result);
});

export default router;
