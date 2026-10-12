import { Router, type IRouter } from "express";
import { getStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";

// Supply item validation — strips items that could not have come from a
// legitimate picker (non-integer ID, non-positive quantity, empty name).
function normaliseSupplies(raw: unknown): { inventoryItemId: number; name: string; quantity: number; unit: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { inventoryItemId: number; name: string; quantity: number; unit: string }[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const { inventoryItemId, name, quantity, unit } = s as Record<string, unknown>;
    // Reject any non-integer value — parseInt("1.5") → 1 and parseInt("1abc") → 1
    // would both pass an isInteger check, so we only accept already-integer numbers.
    if (!Number.isInteger(inventoryItemId) || (inventoryItemId as number) <= 0) continue;
    const id = inventoryItemId as number;
    const qty = typeof quantity === "number" ? quantity : (typeof quantity === "string" && /^\d+(\.\d+)?$/.test(quantity.trim()) ? parseFloat(quantity) : NaN);
    if (!isFinite(qty) || qty <= 0) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({ inventoryItemId: id, name: String(name).trim(), quantity: qty, unit: typeof unit === "string" ? unit.trim() : "" });
  }
  return out;
}
import crypto from "crypto";
import { db, jobsTable, customersTable, usersTable, propertiesTable, activityLogTable, inventoryItemsTable, crewsTable, crewMembersTable, customerAlertsTable, invoicesTable, tenantsTable, blueprintsTable, chemicalApplicationsTable, chemicalProductsTable, chemicalMixtureItemsTable, customerPlansTable, equipmentFuelLogsTable, routeTemplatesTable, skipReasonsTable, taskNotificationsTable, internalTasksTable, portalMessagesTable, servicesTable } from "@workspace/db";
import { eq, and, or, sql, desc, asc, isNotNull, isNull, ne, inArray, min, gt } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { rescheduleFee } from "../lib/rescheduleFee";
import { invoiceDocumentDefaults } from "../lib/invoiceDocumentDefaults";
import { getCallerRole, isAdminRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { resendReminderForJob } from "../lib/reminderScheduler";
import { nthOccurrenceAfterRoot, describeRule, type RecurrenceRule } from "../lib/recurrenceEngine";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { checkRainBeforeWindow } from "../lib/weatherCheck";
import { datedJobInvoiceItems } from "../lib/invoiceServiceDate";
import { automaticInvoiceSending, holdUnpricedJobs } from "../lib/billingAutomation";
import { chemicalCompletionError, normalizeFieldRequirements } from "../lib/serviceFieldRequirements";
import { resolveJobAssignmentRecipientIds, sendStaffPush } from "../lib/pushNotifications";
import { canAccessJobMessages } from "../lib/jobMessageAccess";
import { type PricingTier } from "../lib/pricingMatrix";
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

type JobMeasurementPolygon = {
  zoneTypeId?: string | null;
  label?: string | null;
  areaSqft?: number | null;
  lengthFt?: number | null;
  mode?: "area" | "linear";
  enabled?: boolean;
};
type MeasurementZoneType = { id: string; name: string; mode?: "area" | "linear" };

/**
 * Creates an immutable catalog snapshot for a newly scheduled job. Matrix
 * pricing deliberately stays unresolved when the relevant measurement is not
 * available: choosing the first tier (or pricing it at zero) would invoice the
 * wrong amount.
 */
async function resolveServiceJobSnapshot(
  tenantId: number,
  serviceId: unknown,
  propertyId: number | null,
): Promise<{ service: typeof servicesTable.$inferSelect; lineItems?: unknown[]; totalAmount?: number; estimatedDuration: number | null } | null> {
  if (serviceId === undefined || serviceId === null || serviceId === "") return null;
  const id = typeof serviceId === "number" ? serviceId : parseInt(String(serviceId), 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error("serviceId must be a valid integer");
  const [service] = await db.select().from(servicesTable).where(and(
    eq(servicesTable.id, id), eq(servicesTable.tenantId, tenantId), eq(servicesTable.isActive, true),
  ));
  if (!service) throw new Error("Selected service is not active or is not available");

  // Flat services never depend on property measurements.
  if (service.pricingMode === "flat") {
    const price = service.basePrice;
    return {
      service,
      estimatedDuration: service.estimatedDuration ?? null,
      totalAmount: price,
      lineItems: [{ serviceId: service.id, description: service.name, quantity: 1, qty: 1, unitPrice: price, total: price }],
    };
  }

  if (service.pricingMode !== "matrix" || !propertyId) {
    return { service, estimatedDuration: service.estimatedDuration ?? null };
  }
  const [property] = await db.select({
    measurementPolygons: propertiesTable.measurementPolygons,
    serviceableAreaSqft: propertiesTable.serviceableAreaSqft,
  }).from(propertiesTable).where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) return { service, estimatedDuration: service.estimatedDuration ?? null };

  const [tenant] = await db.select({ measurementZoneTypes: tenantsTable.measurementZoneTypes })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const zoneTypes = ((tenant?.measurementZoneTypes as unknown[]) ?? []) as MeasurementZoneType[];
  const polygons = ((property.measurementPolygons as unknown[]) ?? []) as JobMeasurementPolygon[];
  const zoneByName = new Map(zoneTypes.map(zone => [zone.name, zone]));
  const zoneById = new Map(zoneTypes.map(zone => [zone.id, zone]));
  let areaSqft = 0;
  let lengthFt = 0;
  let foundMeasurement = false;
  for (const polygon of polygons) {
    if (polygon.enabled === false) continue;
    const zone = polygon.zoneTypeId ? zoneById.get(polygon.zoneTypeId) : (polygon.label ? zoneByName.get(polygon.label) : undefined);
    if (service.linkedZoneTypeId && zone?.id !== service.linkedZoneTypeId && polygon.zoneTypeId !== service.linkedZoneTypeId) continue;
    const mode = polygon.mode ?? zone?.mode ?? "area";
    if (mode === "linear" && Number.isFinite(polygon.lengthFt)) { lengthFt += polygon.lengthFt!; foundMeasurement = true; }
    if (mode !== "linear" && Number.isFinite(polygon.areaSqft)) { areaSqft += polygon.areaSqft!; foundMeasurement = true; }
  }
  // An unlinked service can use the property's established aggregate area.
  if (!service.linkedZoneTypeId && !foundMeasurement && property.serviceableAreaSqft != null) {
    areaSqft = property.serviceableAreaSqft;
    foundMeasurement = true;
  }
  if (!foundMeasurement) return { service, estimatedDuration: service.estimatedDuration ?? null };

  const quantity = service.linkedZoneTypeId && zoneById.get(service.linkedZoneTypeId)?.mode === "linear" ? lengthFt : areaSqft;
  const tiers = Array.isArray(service.pricingMatrix) ? service.pricingMatrix as PricingTier[] : [];
  const tier = [...tiers].sort((a, b) => a.minSqft - b.minSqft)
    .find(candidate => quantity >= candidate.minSqft && (candidate.maxSqft === null || quantity <= candidate.maxSqft));
  if (!tier) return { service, estimatedDuration: service.estimatedDuration ?? null };
  const price = tier.maxSqft === null && tier.perSqftRate != null && tier.perSqftRate > 0
    ? tier.perSqftRate * quantity : tier.price;
  return {
    service,
    estimatedDuration: tier.estimatedMinutes != null && tier.estimatedMinutes > 0 ? tier.estimatedMinutes : service.estimatedDuration ?? null,
    totalAmount: price,
    lineItems: [{ serviceId: service.id, description: service.name, quantity: 1, qty: 1, unitPrice: price, total: price }],
  };
}

async function validateJobAssignment(
  tenantId: number,
  assigneeId: number | null,
  crewId: number | null,
): Promise<string | null> {
  if (assigneeId && crewId) return "A job can be assigned to an individual or a crew, not both";
  if (crewId) {
    const [crew] = await db.select({ id: crewsTable.id }).from(crewsTable)
      .where(and(eq(crewsTable.id, crewId), eq(crewsTable.tenantId, tenantId)));
    if (!crew) return "Selected crew is not available";
  }
  if (assigneeId) {
    const [row] = await db
      .select({ role: usersTable.role, isActive: usersTable.isActive, ownersSchedulable: tenantsTable.ownersSchedulable })
      .from(usersTable)
      .innerJoin(tenantsTable, eq(tenantsTable.id, usersTable.tenantId))
      .where(and(eq(usersTable.id, assigneeId), eq(usersTable.tenantId, tenantId)));
    const eligible = row?.isActive && (
      row.role === "technician"
      || row.role === "crew_manager"
      || (row.role === "company_owner" && row.ownersSchedulable)
    );
    if (!eligible) return "Selected individual is not eligible for job assignment";
  }
  return null;
}

function assignmentChanged(
  previous: { assigneeId: number | null; crewId: number | null },
  next: { assigneeId: number | null; crewId: number | null },
): boolean {
  return previous.assigneeId !== next.assigneeId || previous.crewId !== next.crewId;
}

function notifyJobAssignment(
  tenantId: number, job: { id: number; title: string; assigneeId: number | null; crewId: number | null },
  eventKey: string, actorUserId?: number, previous?: { assigneeId: number | null; crewId: number | null },
): void {
  void Promise.all([
    resolveJobAssignmentRecipientIds(tenantId, job.assigneeId, job.crewId),
    previous ? resolveJobAssignmentRecipientIds(tenantId, previous.assigneeId, previous.crewId) : Promise.resolve([]),
  ])
    .then(([recipientUserIds, previousRecipientIds]) => sendStaffPush({
      // Reassignment alerts are for people newly added by this assignment, not
      // crew members who were already assigned before the edit.
      recipientUserIds: recipientUserIds.filter(id => !previousRecipientIds.includes(id) && id !== actorUserId),
      tenantId,
      eventKey, title: "Job assigned", body: `You have been assigned: ${job.title}`,
      data: { type: "job_assignment", jobId: job.id },
    }))
    .catch(err => logger.error({ err, tenantId, jobId: job.id }, "Failed to resolve job assignment push recipients"));
}

/** Returns the completion blocker, if this job's tenant service requires an application. */
async function chemicalCompletionBlocker(tenantId: number, jobId: number): Promise<string | null> {
  const [row] = await db.select({ requirements: servicesTable.fieldRequirements })
    .from(jobsTable)
    .leftJoin(servicesTable, and(eq(jobsTable.serviceId, servicesTable.id), eq(servicesTable.tenantId, tenantId)))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!normalizeFieldRequirements(row?.requirements).requiresChemicalApplication) return null;
  const [application] = await db.select({ id: chemicalApplicationsTable.id })
    .from(chemicalApplicationsTable)
    .where(and(eq(chemicalApplicationsTable.tenantId, tenantId), eq(chemicalApplicationsTable.jobId, jobId)))
    .limit(1);
  return chemicalCompletionError(row?.requirements, !!application);
}

function isValidMonthDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(2000, month, 0).getDate();
}

function resolveOffSeasonWindow(start: unknown, end: unknown): { offSeasonStart: string; offSeasonEnd: string } | null | undefined {
  if (start === undefined && end === undefined) return undefined;
  if ((start === null || start === "") && (end === null || end === "")) return null;
  if (isValidMonthDay(start) && isValidMonthDay(end)) return { offSeasonStart: start, offSeasonEnd: end };
  throw new Error("offSeasonStart and offSeasonEnd must be provided together as valid MM-DD dates");
}

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

router.post("/jobs/import/preview", requireVerifiedStaff, importUpload.single("file"), async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, userId = res.locals.staffUserId as number;
  if (!["company_owner", "office_manager", "department_manager", "crew_manager"].includes(await getCallerRole(tenantId, userId))) {
    res.status(403).json({ error: "Manager role required to import jobs" });
    return;
  }
  await handleImportPreview(req, res, tenantId, jobsImportExportConfig);
});

router.post("/jobs/import/commit", requireVerifiedStaff, importUpload.single("file"), async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number, userId = res.locals.staffUserId as number;
  if (!["company_owner", "office_manager", "department_manager", "crew_manager"].includes(await getCallerRole(tenantId, userId))) {
    res.status(403).json({ error: "Manager role required to import jobs" });
    return;
  }
  await handleImportCommit(req, res, tenantId, jobsImportExportConfig);
});

function formatJob(
  j: typeof jobsTable.$inferSelect,
  extras?: { customerName?: string | null; customerPhone?: string | null; customerNotes?: string | null; assigneeName?: string | null; propertyAddress?: string | null; propertyNotes?: string | null; crewName?: string | null; planName?: string | null; routeName?: string | null; serviceName?: string | null; fieldRequirements?: unknown }
) {
  const rule = j.recurrenceRule as unknown as RecurrenceRule | null;
  return {
    ...j,
    lineItems: (j.lineItems as unknown[]) ?? [],
    jobParts: (j.jobParts as unknown[]) ?? [],
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    archivedAt: j.archivedAt?.toISOString() ?? null,
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
    serviceName: extras?.serviceName ?? null,
    fieldRequirements: normalizeFieldRequirements(extras?.fieldRequirements),
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
    offSeasonStart: (j as any).offSeasonStart ?? null,
    offSeasonEnd: (j as any).offSeasonEnd ?? null,
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { status, assigneeId, startDate, endDate, customerId, crewId, routeTemplateId, propertyId, includeArchived } = req.query as Record<string, string>;

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if ((startDate && (!start || Number.isNaN(start.getTime()))) || (endDate && (!end || Number.isNaN(end.getTime())))) {
    res.status(400).json({ error: "startDate and endDate must be valid ISO-8601 timestamps" });
    return;
  }
  if (start && end && end <= start) {
    res.status(400).json({ error: "endDate must be later than startDate" });
    return;
  }

  let where = includeArchived === "true"
    ? eq(jobsTable.tenantId, tenantId)
    : and(eq(jobsTable.tenantId, tenantId), isNull(jobsTable.archivedAt));
  const callerRole = await getCallerRole(tenantId, userId);
  if (callerRole === "technician") {
    // Technician visibility is derived solely from the authenticated user, never
    // from an assigneeId supplied by the client. Crew assignment follows the
    // established job-access convention used by time tracking.
    const memberships = await db.select({ crewId: crewMembersTable.crewId }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId),
      eq(crewMembersTable.userId, userId),
    ));
    const crewIds = memberships.map(member => member.crewId);
    const visibility = crewIds.length
      ? or(eq(jobsTable.assigneeId, userId), inArray(jobsTable.crewId, crewIds))
      : eq(jobsTable.assigneeId, userId);
    where = and(where, visibility) as typeof where;
  } else if (assigneeId && /^\d+$/.test(assigneeId)) {
    where = and(where, eq(jobsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  }
  if (status) where = and(where, eq(jobsTable.status, status)) as typeof where;
  if (crewId) where = and(where, eq(jobsTable.crewId, parseInt(crewId, 10))) as typeof where;
  if (customerId) where = and(where, eq(jobsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (propertyId) where = and(where, eq(jobsTable.propertyId, parseInt(propertyId, 10))) as typeof where;
  if (routeTemplateId) where = and(where, eq(jobsTable.routeTemplateId, parseInt(routeTemplateId, 10))) as typeof where;
  if (start) where = and(where, sql`${jobsTable.scheduledAt} >= ${start.toISOString()}::timestamptz`) as typeof where;
  // endDate is exclusive, allowing callers to query local calendar ranges without
  // dropping jobs scheduled in the final millisecond of a day.
  if (end) where = and(where, sql`${jobsTable.scheduledAt} < ${end.toISOString()}::timestamptz`) as typeof where;

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
      serviceName: servicesTable.name,
      fieldRequirements: servicesTable.fieldRequirements,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .leftJoin(customerPlansTable, eq(jobsTable.planId, customerPlansTable.id))
    .leftJoin(routeTemplatesTable, eq(jobsTable.routeTemplateId, routeTemplatesTable.id))
    .leftJoin(servicesTable, and(eq(jobsTable.serviceId, servicesTable.id), eq(servicesTable.tenantId, tenantId)))
    .where(where)
    .orderBy(jobsTable.scheduledAt);

  res.json(rows.map(r => formatJob(r.job, { customerName: r.customerName, customerPhone: r.customerPhone, customerNotes: r.customerNotes, assigneeName: r.assigneeName, propertyAddress: r.propertyAddress, propertyNotes: r.propertyNotes, crewName: r.crewName, planName: r.planName, routeName: r.routeName, serviceName: r.serviceName, fieldRequirements: r.fieldRequirements })));
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

router.post("/jobs", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  // Field staff submit a reviewable job request instead of creating schedule entries
  // directly. This keeps unapproved work off dispatch boards and calendars.
  const callerRole = await getCallerRole(tenantId, userId);
  if (!["company_owner", "office_manager", "department_manager", "crew_manager"].includes(callerRole)) {
    res.status(403).json({ error: "Manager role required to create jobs directly" });
    return;
  }
  const { title, description, status, priority, customerId, propertyId, assigneeId, crewId, scheduledAt, estimatedDuration, blueprintId, recurrenceRule, smsReminderEnabled, suppliesNeeded, offSeasonStart, offSeasonEnd, serviceId, lineItems, totalAmount } = req.body;

  if (!title || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }
  const resolvedAssigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  const resolvedCrewId = crewId ? parseInt(crewId, 10) : null;
  const assignmentError = await validateJobAssignment(tenantId, resolvedAssigneeId, resolvedCrewId);
  if (assignmentError) { res.status(400).json({ error: assignmentError }); return; }
  let offSeasonWindow: ReturnType<typeof resolveOffSeasonWindow>;
  try {
    offSeasonWindow = resolveOffSeasonWindow(offSeasonStart, offSeasonEnd);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid off-season window" });
    return;
  }
  const resolvedPropertyId = propertyId ? parseInt(propertyId, 10) : null;
  let serviceSnapshot: Awaited<ReturnType<typeof resolveServiceJobSnapshot>>;
  try {
    serviceSnapshot = await resolveServiceJobSnapshot(tenantId, serviceId, resolvedPropertyId);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid service" });
    return;
  }
  const callerSuppliedLineItems = Array.isArray(lineItems);
  const callerSuppliedTotal = totalAmount !== undefined && totalAmount !== null && totalAmount !== "";

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title,
    description: description ?? null,
    status: status ?? "scheduled",
    priority: priority ?? "normal",
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: resolvedPropertyId,
    assigneeId: resolvedAssigneeId,
    crewId: resolvedCrewId,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    scheduledAt: new Date(scheduledAt),
    serviceId: serviceSnapshot?.service.id ?? null,
    estimatedDuration: estimatedDuration !== undefined ? estimatedDuration : (serviceSnapshot?.estimatedDuration ?? null),
    ...(callerSuppliedLineItems ? { lineItems } : serviceSnapshot?.lineItems ? { lineItems: serviceSnapshot.lineItems } : {}),
    ...(callerSuppliedTotal ? { totalAmount: Number(totalAmount) } : serviceSnapshot?.totalAmount !== undefined ? { totalAmount: serviceSnapshot.totalAmount } : {}),
    recurrenceRule: recurrenceRule ?? null,
    smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true",
    suppliesNeeded: normaliseSupplies(suppliesNeeded),
    ...(offSeasonWindow && { ...offSeasonWindow }),
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_created", message: `Job "${title}" created`, entityId: job.id });
  if (job.assigneeId || job.crewId) {
    notifyJobAssignment(tenantId, job, `job-assignment:${job.id}:create`, userId);
  }

  res.status(201).json(formatJob(job));
});

// ---------------------------------------------------------------------------
// GET /jobs/pending-requests — list all jobs with a pending cancel or reschedule request
// Registered BEFORE /jobs/:id to avoid Express treating "pending-requests" as an id.
// ---------------------------------------------------------------------------
router.get("/jobs/pending-requests", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const admin = await isAdminRole(tenantId, getUserId(req));
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required" });
    return;
  }

  const rows = await db
    .select({
      id: jobsTable.id,
      title: jobsTable.title,
      status: jobsTable.status,
      scheduledAt: jobsTable.scheduledAt,
      customerId: jobsTable.customerId,
      customerName: customersTable.name,
      cancellationRequestedAt: (jobsTable as any).cancellationRequestedAt,
      cancellationReason: (jobsTable as any).cancellationReason,
      cancelRequestStatus: (jobsTable as any).cancelRequestStatus,
      rescheduleRequestedAt: (jobsTable as any).rescheduleRequestedAt,
      reschedulePreferredDate: (jobsTable as any).reschedulePreferredDate,
      rescheduleRequestStatus: (jobsTable as any).rescheduleRequestStatus,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        or(
          and(
            isNotNull((jobsTable as any).cancellationRequestedAt),
            or(
              isNull((jobsTable as any).cancelRequestStatus),
              eq((jobsTable as any).cancelRequestStatus, "pending"),
            ),
          ),
          and(
            isNotNull((jobsTable as any).rescheduleRequestedAt),
            or(
              isNull((jobsTable as any).rescheduleRequestStatus),
              eq((jobsTable as any).rescheduleRequestStatus, "pending"),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(jobsTable.scheduledAt));

  res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    scheduledAt: r.scheduledAt.toISOString(),
    customerId: r.customerId,
    customerName: r.customerName ?? null,
    // Derive requestType from whichever request is actually pending (including legacy null-status).
    requestType: (
      r.cancellationRequestedAt &&
      (r.cancelRequestStatus === "pending" || r.cancelRequestStatus === null)
    ) ? "cancel" : "reschedule",
    requestedAt: r.cancellationRequestedAt
      ? new Date(r.cancellationRequestedAt).toISOString()
      : new Date(r.rescheduleRequestedAt).toISOString(),
    reason: r.cancellationReason ?? null,
    preferredDate: r.reschedulePreferredDate ?? null,
  })));
});

router.get("/jobs/:id", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id) || !(await canAccessJobMessages(tenantId, userId, id))) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [row] = await db
    .select({ job: jobsTable, customerName: customersTable.name, customerPhone: customersTable.phone, customerNotes: customersTable.notes, assigneeName: usersTable.name, propertyAddress: propertiesTable.address, propertyNotes: propertiesTable.notes, crewName: crewsTable.name, planName: customerPlansTable.templateName, routeName: routeTemplatesTable.name, serviceName: servicesTable.name, fieldRequirements: servicesTable.fieldRequirements })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .leftJoin(customerPlansTable, eq(jobsTable.planId, customerPlansTable.id))
    .leftJoin(routeTemplatesTable, eq(jobsTable.routeTemplateId, routeTemplatesTable.id))
    .leftJoin(servicesTable, and(eq(jobsTable.serviceId, servicesTable.id), eq(servicesTable.tenantId, tenantId)))
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(row.job, { customerName: row.customerName, customerPhone: row.customerPhone, customerNotes: row.customerNotes, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress, propertyNotes: row.propertyNotes, crewName: row.crewName, planName: row.planName, routeName: row.routeName, serviceName: row.serviceName, fieldRequirements: row.fieldRequirements }));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { title, description, status, priority, assigneeId, crewId, scheduledAt, estimatedDuration, recurrenceRule, editScope, smsReminderEnabled, holdFromBilling, planId, tags, suppliesNeeded, offSeasonStart, offSeasonEnd, serviceId } = req.body;

  // Fetch current job to check if it's a recurring instance
  const [currentJob] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!currentJob) { res.status(404).json({ error: "Not found" }); return; }
  let serviceSnapshot: Awaited<ReturnType<typeof resolveServiceJobSnapshot>> | undefined;
  if (serviceId !== undefined) {
    if (serviceId === null || serviceId === "") {
      serviceSnapshot = null;
    } else {
      try {
        serviceSnapshot = await resolveServiceJobSnapshot(tenantId, serviceId, currentJob.propertyId);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid service" });
        return;
      }
    }
  }
  // Completion may affect an entire recurrence scope. Check each target before
  // any update so a required chemical log cannot be bypassed by series editing.
  if (status === "completed") {
    const rootId = currentJob.recurrenceParentId ?? id;
    const targets = editScope === "all"
      ? await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.tenantId, tenantId), or(eq(jobsTable.id, rootId), eq(jobsTable.recurrenceParentId, rootId))))
      : editScope === "forward"
      ? await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.tenantId, tenantId), or(eq(jobsTable.id, rootId), and(eq(jobsTable.recurrenceParentId, rootId), eq(jobsTable.status, "scheduled"), sql`${jobsTable.recurrenceIndex} >= ${currentJob.recurrenceIndex ?? 0}`))))
      : [{ id }];
    for (const target of targets) {
      const blocker = await chemicalCompletionBlocker(tenantId, target.id);
      if (blocker) { res.status(422).json({ error: blocker, message: blocker }); return; }
    }
  }
  let offSeasonWindow: ReturnType<typeof resolveOffSeasonWindow>;
  try {
    offSeasonWindow = resolveOffSeasonWindow(offSeasonStart, offSeasonEnd);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid off-season window" });
    return;
  }

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
  let feeUpdates: ReturnType<typeof rescheduleFee> = {};
  if (scheduledAt !== undefined && new Date(scheduledAt).getTime() !== currentJob.scheduledAt.getTime()) {
    const targetDate = new Date(scheduledAt);
    if (Number.isNaN(targetDate.getTime())) { res.status(400).json({ error: "Invalid scheduled date" }); return; }
    if (currentJob.planId) {
      const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, currentJob.planId), eq(customerPlansTable.tenantId, tenantId)));
      if (!plan || (plan.startDate && targetDate < plan.startDate) || (plan.endDate && targetDate > plan.endDate)) {
        res.status(400).json({ error: "The new date must fall within the plan's active period" }); return;
      }
    }
    if (["completed", "cancelled"].includes(currentJob.status)) { res.status(409).json({ error: "Completed or cancelled jobs cannot be rescheduled" }); return; }
    if (editScope === "all" || editScope === "forward") { res.status(400).json({ error: "Reschedule one occurrence at a time so each fee is confirmed separately" }); return; }
    try { feeUpdates = rescheduleFee(currentJob, req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  }
  const shouldSetClockIn =
    status === "in_progress" &&
    currentJob.status !== "in_progress" &&
    !(currentJob as any).clockInAt;

  let nextAssigneeId = assigneeId !== undefined ? (assigneeId ? parseInt(assigneeId, 10) : null) : currentJob.assigneeId;
  let nextCrewId = crewId !== undefined ? (crewId ? parseInt(crewId, 10) : null) : currentJob.crewId;
  if (assigneeId) nextCrewId = null;
  if (crewId) nextAssigneeId = null;
  const assignmentWasRequested = assigneeId !== undefined || crewId !== undefined;
  if (assignmentWasRequested) {
    const assignmentError = await validateJobAssignment(tenantId, nextAssigneeId, nextCrewId);
    if (assignmentError) { res.status(400).json({ error: assignmentError }); return; }
  }

  const baseUpdate: Partial<typeof jobsTable.$inferInsert> = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(priority !== undefined && { priority }),
    ...(shouldSetClockIn && { clockInAt: new Date() } as any),
    ...(assignmentWasRequested && { assigneeId: nextAssigneeId, crewId: nextCrewId }),
    ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
    ...(serviceSnapshot !== undefined && {
      serviceId: serviceSnapshot?.service.id ?? null,
      lineItems: serviceSnapshot?.lineItems ?? [],
      totalAmount: serviceSnapshot?.totalAmount ?? 0,
      estimatedDuration: serviceSnapshot?.estimatedDuration ?? null,
    }),
    ...(estimatedDuration !== undefined && { estimatedDuration }),
    ...(suppliesNeeded !== undefined && { suppliesNeeded: normaliseSupplies(suppliesNeeded) }),
    ...(smsReminderEnabled !== undefined && { smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true" }),
    ...(holdFromBilling !== undefined && { holdFromBilling: holdFromBilling === true || holdFromBilling === "true" }),
    ...(resolvedPlanId !== undefined && { planId: resolvedPlanId }),
    ...(tags !== undefined && { tags }),
    ...(offSeasonWindow === null && { offSeasonStart: null, offSeasonEnd: null }),
    ...(offSeasonWindow && { ...offSeasonWindow }),
  };
  const nextAssignment = {
    assigneeId: nextAssigneeId,
    crewId: nextCrewId,
  };
  const didChangeAssignment = assignmentChanged(currentJob, nextAssignment);

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
    if (didChangeAssignment) {
      // A scope edit changes one dispatch decision; send one recipient-deduplicated
      // event rather than one noisy event per generated recurrence instance.
      notifyJobAssignment(
        tenantId,
        updated,
        `job-assignment:${currentJob.recurrenceParentId ?? id}:${editScope}:${updated.updatedAt.getTime()}`,
        getUserId(req),
        currentJob,
      );
    }
    res.json(formatJob(updated));
    return;
  }

  // Default: update only this occurrence
  Object.assign(baseUpdate, feeUpdates);
  if (recurrenceRule !== undefined && !currentJob.recurrenceParentId) {
    baseUpdate.recurrenceRule = recurrenceRule;
  }

  const [updated] = await db.update(jobsTable)
    .set(baseUpdate)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId), eq(jobsTable.scheduledAt, currentJob.scheduledAt)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (didChangeAssignment) {
    notifyJobAssignment(
      tenantId,
      updated,
      `job-assignment:${updated.id}:update:${updated.updatedAt.getTime()}`,
      getUserId(req),
      currentJob,
    );
  }

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

// ── Shared helper: run all completion side effects ───────────────────────────
// Called by both /jobs/:id/complete and /jobs/:id/complete-and-invoice so that
// chemical rainfast timers, the rainfast weather alert, and blueprint archival
// are never skipped regardless of which completion path was used.
async function runJobCompletionSideEffects(params: {
  id: number;
  tenantId: number;
  userId: number;
  jobTitle: string;
  propertyId?: number | null;
  blueprintId?: number | null;
  completedAt: Date;
}): Promise<void> {
  const { id, tenantId, userId, jobTitle, propertyId, blueprintId, completedAt } = params;

  // Compute and store rainfast / re-entry timer expiry for any chemical applications on this job.
  // Awaited synchronously — timers must be persisted before this function returns so the portal
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
        ? new Date(completedAt.getTime() + maxRainfastHours * 3600 * 1000)
        : null;
      const reentryUntil = maxRei != null
        ? new Date(completedAt.getTime() + maxRei * 3600 * 1000)
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
      if (!propertyId) return;
      const [property] = await db
        .select({ lat: propertiesTable.lat, lng: propertiesTable.lng })
        .from(propertiesTable)
        .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
      if (!property?.lat || !property?.lng) return;

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

      const [tenantSettings] = await db
        .select({ rainfastRainThresholdPct: tenantsTable.rainfastRainThresholdPct })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId));
      const thresholdPct = tenantSettings?.rainfastRainThresholdPct ?? 40;

      let latestWindow: Date | null = null;
      for (const app of appsWithRainfast) {
        if (app.rainfastUntil && (latestWindow === null || app.rainfastUntil > latestWindow)) {
          latestWindow = app.rainfastUntil;
        }
      }
      if (!latestWindow) return;

      const rainForecast = await checkRainBeforeWindow(
        property.lat,
        property.lng,
        latestWindow,
        thresholdPct,
      );
      if (!rainForecast) return;

      const chemLines = appsWithRainfast.map(app => {
        const name = app.productName ?? app.mixtureName ?? "Unknown chemical";
        const until = app.rainfastUntil ? new Date(app.rainfastUntil).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }) : "—";
        return `• ${name} — rainfast window closes ${until}`;
      });
      const forecastTimeStr = new Date(rainForecast.forecastTime).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
      });
      const description = [
        `Rain (${rainForecast.probability}% probability) is forecast around ${forecastTimeStr} — before the rainfast window closes on job #${id} "${jobTitle}".`,
        ``,
        `Affected applications:`,
        ...chemLines,
        ``,
        `Consider re-applying affected chemicals after the window has passed if significant rainfall occurs.`,
      ].join("\n");

      const [task] = await db.insert(internalTasksTable).values({
        tenantId,
        title: `⚠️ Rain forecast before rainfast window — Job #${id} "${jobTitle}"`,
        description,
        taskType: "custom",
        createdById: userId,
        assignedToRole: "admin_office",
        priority: "high",
        status: "open",
        contextType: "job",
        contextId: id,
      }).returning({ id: internalTasksTable.id });

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
            message: `⚠️ Rain (${rainForecast.probability}%) forecast before rainfast window closes — Job #${id} "${jobTitle}"`,
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
    .where(and(eq(blueprintsTable.tenantId, tenantId), or(eq(blueprintsTable.jobId, id), eq(blueprintsTable.id, blueprintId ?? -1))));
}

router.post("/jobs/:id/reopen", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const [updated] = await db.update(jobsTable)
    .set({ status: "scheduled", completedAt: null })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId), eq(jobsTable.status, "completed")))
    .returning();
  if (!updated) { res.status(404).json({ error: "Completed job not found" }); return; }
  await db.insert(activityLogTable).values({
    tenantId,
    userId,
    type: "job_reopened",
    message: `Job "${updated.title}" returned to scheduled`,
    entityId: id,
  });
  res.json(formatJob(updated));
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const blocker = await chemicalCompletionBlocker(tenantId, id);
  if (blocker) { res.status(422).json({ error: blocker, message: blocker }); return; }

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

  // Run chemical timer expiry, rainfast weather alert (fire-and-forget), and blueprint archival
  // via the shared helper so every completion path has identical side effects.
  await runJobCompletionSideEffects({ id, tenantId, userId, jobTitle: updated.title, propertyId: updated.propertyId, blueprintId: (updated as any).blueprintId ?? null, completedAt: now });

  // If this job was converted from an estimate with "Invoice after job" chosen, auto-create a draft invoice now.
  await holdUnpricedJobs(tenantId);
  if (updated.planId) {
    res.json(formatJob(updated));
    return;
  }
  if (updated.totalAmount <= 0 || updated.holdFromBilling) {
    res.json(formatJob({ ...updated, holdFromBilling: true }));
    return;
  }
  // Recurring visits belong to their billing cycle, never one invoice per completion.
  if (updated.recurrenceRule || updated.recurrenceParentId) {
    res.json(formatJob(updated));
    return;
  }
  const sendAutomatically = await automaticInvoiceSending(tenantId);
  // On success → return early. On failure → flag the job for the weekly billing sweep so it is never permanently unbilled.
  if ((updated as any).invoiceAfterJob && (updated as any).estimateId && updated.customerId && !updated.invoiceId) {
    let deferredInvoiceCreated = false;
    try {
      const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      const taxRate = tenant?.taxRate ?? 0;
      const lineItems = await datedJobInvoiceItems(tenantId, updated);
      const subtotal = updated.totalAmount ?? 0;
      const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = subtotal + tax;
      const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;
      const [billingCustomer] = await db.select({ email: customersTable.email }).from(customersTable)
        .where(and(eq(customersTable.id, updated.customerId), eq(customersTable.tenantId, tenantId)));
      let createdInvoiceId: number | null = null;

      await db.transaction(async tx => {
        const [invoice] = await tx.insert(invoicesTable).values({
          ...await invoiceDocumentDefaults(tenantId),
          tenantId,
          invoiceNumber: invoiceNum,
          customerId: updated.customerId!,
          jobId: updated.id,
          status: sendAutomatically && billingCustomer?.email ? "sent" : "draft",
          publicToken: sendAutomatically && billingCustomer?.email ? crypto.randomBytes(32).toString("hex") : null,
          subtotal,
          tax,
          total,
          lineItems,
        }).returning();
        createdInvoiceId = invoice.id;
        await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, id));
        // Activity log inside the same transaction for full atomicity
        await tx.insert(activityLogTable).values({ tenantId, userId, type: "invoice_created", message: `Draft invoice ${invoiceNum} auto-created on estimate-sourced job completion`, entityId: invoice.id });
      });
      deferredInvoiceCreated = true;
      if (sendAutomatically && billingCustomer?.email && createdInvoiceId) await enqueueInvoiceEmail(tenantId, createdInvoiceId);
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
        const lineItems = await datedJobInvoiceItems(tenantId, updated);
        const subtotal = updated.totalAmount ?? 0;
        const tax = subtotal * (taxRate / 100);
        const total = subtotal + tax;
        const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

        let invoiceId!: number;
        await db.transaction(async tx => {
          const [invoice] = await tx.insert(invoicesTable).values({
            ...await invoiceDocumentDefaults(tenantId),
            tenantId,
            invoiceNumber: invoiceNum,
            customerId: updated.customerId!,
            jobId: updated.id,
            status: sendAutomatically && customer.email ? "sent" : "draft",
            publicToken: sendAutomatically && customer.email ? crypto.randomBytes(32).toString("hex") : null,
            subtotal,
            tax,
            total,
            lineItems,
          }).returning();
          invoiceId = invoice.id;
          await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, id));
        });

        await db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_sent", message: `Auto-invoice ${invoiceNum} created on job completion`, entityId: invoiceId });

        if (sendAutomatically && customer.email) {
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

// ── Complete & Invoice (atomic) ───────────────────────────────────────────────
// Marks the job completed (if not already) and creates an invoice in a single
// transaction so the two can never diverge. Returns the created invoice.
// Returns 409 if the job already has an invoice (concurrency-safe via
// conditional update returning), 422 if the job is cancelled.
router.post("/jobs/:id/complete-and-invoice", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  // Load job + tenant tax rate in one query
  const [[job], [tenantRow]] = await Promise.all([
    db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))),
    db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)),
  ]);

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status === "cancelled") { res.status(422).json({ error: "Cannot invoice a cancelled job" }); return; }
  if (!(job.totalAmount > 0)) { res.status(422).json({ error: "Add a customer price before creating an invoice. Free or plan-covered work can be completed without invoicing." }); return; }
  if (job.status !== "completed") {
    const blocker = await chemicalCompletionBlocker(tenantId, id);
    if (blocker) { res.status(422).json({ error: blocker, message: blocker }); return; }
  }
  // Pre-flight check (non-locking — transactional guard below provides the real safety)
  if (job.invoiceId) { res.status(409).json({ error: "An invoice already exists for this job" }); return; }

  const taxRate = tenantRow?.taxRate ?? 0;
  const completionTime = job.completedAt ?? new Date();
  const lineItems = await datedJobInvoiceItems(tenantId, { ...job, completedAt: completionTime });
  const subtotal = job.totalAmount ?? 0;
  const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = subtotal + tax;
  const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;
  const now = completionTime;

  let invoice!: typeof invoicesTable.$inferSelect;
  let wasAlreadyCompleted = job.status === "completed";

  try {
    await db.transaction(async tx => {
      // Mark complete if not already (append completion date to description)
      if (!wasAlreadyCompleted) {
        const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        const existing = job.description ?? "";
        const newDescription = existing ? `${existing}\n\nService completed: ${dateStr}` : `Service completed: ${dateStr}`;
        await tx.update(jobsTable)
          .set({ status: "completed", completedAt: now, description: newDescription })
          .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
      }

      // Create the invoice
      const [created] = await tx.insert(invoicesTable).values({
        ...await invoiceDocumentDefaults(tenantId),
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
      invoice = created;

      // Link the invoice to the job — WHERE invoiceId IS NULL is the concurrency guard:
      // if another request already set invoiceId, this returns an empty array and we throw 409.
      const [linked] = await tx.update(jobsTable)
        .set({ invoiceId: invoice.id })
        .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId), isNull(jobsTable.invoiceId)))
        .returning({ id: jobsTable.id });
      if (!linked) throw Object.assign(new Error("invoice_exists"), { httpStatus: 409 });
    });
  } catch (err: any) {
    // Catch both our sentinel and any Postgres unique-violation (23505)
    if (err?.httpStatus === 409 || err?.code === "23505") {
      res.status(409).json({ error: "An invoice already exists for this job" }); return;
    }
    throw err;
  }

  // Activity logs (non-fatal)
  await Promise.allSettled([
    !wasAlreadyCompleted
      ? db.insert(activityLogTable).values({ tenantId, userId, type: "job_completed", message: `Job "${job.title}" completed`, entityId: id })
      : Promise.resolve(),
    db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_created", message: `Invoice ${invoiceNum} created from job (complete-and-invoice)`, entityId: invoice.id }),
  ]);

  // Run all the same completion side effects as the /complete endpoint so no
  // safety or archival logic is skipped when invoicing in one step.
  if (!wasAlreadyCompleted) {
    await runJobCompletionSideEffects({ id, tenantId, userId, jobTitle: job.title, propertyId: job.propertyId, blueprintId: (job as any).blueprintId ?? null, completedAt: now });
  }

  res.status(201).json({
    ...invoice,
    lineItems: (invoice.lineItems as unknown[]) ?? [],
    customerName: null,
    planId: invoice.planId ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    stripePaymentUrl: invoice.stripePaymentUrl ?? null,
    publicToken: invoice.publicToken ?? null,
    createdAt: invoice.createdAt.toISOString(),
  });
});

// ── Skip next occurrence ─────────────────────────────────────────────────────
router.post("/jobs/:id/skip-next", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { reasonId, note, feeAmount, feeNote, feeType, feePercent } = req.body as {
    reasonId?: number; note?: string;
    feeAmount?: number; feeNote?: string;
    feeType?: 'flat' | 'percent' | 'both'; feePercent?: number;
  };

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

  // ── Skip fee invoice (fire-and-forget) ────────────────────────────────────
  {
    const resolvedType = feeType ?? 'flat';
    const hasFlat = (resolvedType === 'flat' || resolvedType === 'both') && feeAmount && feeAmount > 0;
    const hasPct  = (resolvedType === 'percent' || resolvedType === 'both') && feePercent && feePercent > 0;
    if ((hasFlat || hasPct) && updated.customerId) {
      (async () => {
        try {
          const lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }> = [];
          if (hasFlat) {
            const desc = feeNote?.trim() || "Skip fee";
            lineItems.push({ description: desc, quantity: 1, unitPrice: feeAmount!, total: feeAmount! });
          }
          if (hasPct) {
            const jobLineItems = (updated.lineItems as Array<{ quantity?: number; unitPrice?: number; total?: number }>) ?? [];
            const jobTotal = jobLineItems.reduce((s, li) => s + (li.total ?? (li.unitPrice ?? 0) * (li.quantity ?? 1)), 0);
            const pctAmount = jobTotal > 0 ? Math.round(jobTotal * feePercent! / 100 * 100) / 100 : 0;
            if (pctAmount > 0) {
              lineItems.push({ description: `${feePercent}% skip surcharge`, quantity: 1, unitPrice: pctAmount, total: pctAmount });
            }
          }
          if (lineItems.length > 0) {
            const total = lineItems.reduce((s, li) => s + li.total, 0);
            await db.insert(invoicesTable).values({
              tenantId,
              customerId: updated.customerId!,
              jobId: updated.id,
              status: "draft",
              subtotal: total,
              total,
              lineItems,
              dueDate: null,
              notes: `Skip fee generated automatically on ${new Date().toLocaleDateString()}`,
              createdById: userId,
            } as any);
          }
        } catch { /* fire-and-forget */ }
      })();
    }
  }

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

  // Read reply before the atomic claim so it can be persisted in the same UPDATE.
  const { reply: approveReply } = req.body as { reply?: string };

  // ── Atomic claim: cancel the job in one conditional UPDATE ──────────────────
  // WHERE includes `cancellationRequestedAt IS NOT NULL` and status guard so
  // only one concurrent request can win; any racing approver gets 0 rows and 409s.
  // This must happen BEFORE any invoice or Stripe work to prevent double-charging.
  const [claimedJob] = await db
    .update(jobsTable)
    .set({ status: "cancelled", cancelRequestStatus: "approved", cancelRequestReply: approveReply?.trim() || null } as any)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.tenantId, tenantId),
        isNotNull((jobsTable as any).cancellationRequestedAt),
        or(
          isNull((jobsTable as any).cancelRequestStatus),
          eq((jobsTable as any).cancelRequestStatus, "pending"),
        ),
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

  // ── Notify customer via portal message (fire-and-forget) ────────────────────
  if (claimedJob.customerId) {
    const approveBody = approveReply?.trim()
      ? `Your cancellation request for "${claimedJob.title}" has been approved. ${approveReply.trim()}`
      : `Your cancellation request for "${claimedJob.title}" has been approved.`;
    db.insert(portalMessagesTable)
      .values({ tenantId, customerId: claimedJob.customerId, direction: "outbound", body: approveBody })
      .catch(err => logger.error({ err, jobId: id }, "Failed to send cancellation-approved portal message"));
  }

  // Job was atomically cancelled in the claim step above; return the claimed record.
  res.json(formatJob(claimedJob));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/deny-cancellation — staff declines a portal cancel request
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

  const { reply } = req.body as { reply?: string };

  // Atomic claim: only declines a job that is still in the pending state.
  // Concurrent approvals or double-declines both get 0 rows → 409.
  const [updated] = await db
    .update(jobsTable)
    .set({
      cancelRequestStatus: "declined",
      cancelRequestReply: reply?.trim() || null,
    } as any)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.tenantId, tenantId),
        isNotNull((jobsTable as any).cancellationRequestedAt),
        or(
          isNull((jobsTable as any).cancelRequestStatus),
          eq((jobsTable as any).cancelRequestStatus, "pending"),
        ),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "No pending cancellation request on this job, or it was already processed" });
    return;
  }

  // Notify customer via portal message (fire-and-forget)
  if (updated.customerId) {
    const body = reply?.trim()
      ? `Your cancellation request for "${updated.title}" was not approved. ${reply.trim()}`
      : `Your cancellation request for "${updated.title}" was not approved. Your job remains scheduled — please contact us if you have questions.`;
    db.insert(portalMessagesTable)
      .values({ tenantId, customerId: updated.customerId, direction: "outbound", body })
      .catch(err => logger.error({ err, jobId: id }, "Failed to send cancellation-denied portal message"));
  }

  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/approve-reschedule — staff approves a portal reschedule request
// ---------------------------------------------------------------------------
router.post("/jobs/:id/approve-reschedule", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required to approve reschedule requests" });
    return;
  }

  const { approvedDate, reply } = req.body as { approvedDate?: string; reply?: string };

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!(job as any).rescheduleRequestedAt) {
    res.status(409).json({ error: "No pending reschedule request on this job" });
    return;
  }

  // Determine the new scheduled date: use the staff-confirmed date if provided,
  // otherwise fall back to the customer's preferred date.
  const newDateStr = approvedDate?.trim() || (job as any).reschedulePreferredDate;
  if (!newDateStr) {
    res.status(400).json({ error: "approvedDate is required when the customer did not provide a preferred date" });
    return;
  }
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRe.test(newDateStr)) {
    res.status(400).json({ error: "approvedDate must be in YYYY-MM-DD format" });
    return;
  }

  // Keep the original time-of-day, move only the calendar date.
  const originalScheduled = new Date(job.scheduledAt);
  const newScheduled = new Date(`${newDateStr}T${originalScheduled.toISOString().slice(11)}`);

  // Guard invalid dates (e.g. 2025-13-01, 2025-99-99) before calling toISOString(),
  // which would throw on an invalid Date. Then also validate round-trip to catch
  // impossible-but-normalised values like Feb 30 → Mar 2.
  if (isNaN(newScheduled.getTime()) || newScheduled.toISOString().slice(0, 10) !== newDateStr) {
    res.status(400).json({ error: "approvedDate is not a valid calendar date" });
    return;
  }

  // Atomic claim: only approves while still in the pending state.
  let requestedFeeUpdates: ReturnType<typeof rescheduleFee>;
  try { requestedFeeUpdates = rescheduleFee(job, req.body); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const [updated] = await db
    .update(jobsTable)
    .set({
      ...requestedFeeUpdates,
      scheduledAt: newScheduled,
      rescheduleRequestStatus: "approved",
      rescheduleRequestReply: reply?.trim() || null,
    } as any)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.tenantId, tenantId),
        isNotNull((jobsTable as any).rescheduleRequestedAt),
        or(
          isNull((jobsTable as any).rescheduleRequestStatus),
          eq((jobsTable as any).rescheduleRequestStatus, "pending"),
        ),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "No pending reschedule request on this job, or it was already processed" });
    return;
  }

  // Notify customer via portal message (fire-and-forget)
  if (job.customerId) {
    const dateLabel = new Date(`${newDateStr}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const body = reply?.trim()
      ? `Your reschedule request for "${job.title}" has been approved. Your new date is ${dateLabel}. ${reply.trim()}`
      : `Your reschedule request for "${job.title}" has been approved. Your new scheduled date is ${dateLabel}.`;
    db.insert(portalMessagesTable)
      .values({ tenantId, customerId: job.customerId, direction: "outbound", body })
      .catch(err => logger.error({ err, jobId: id }, "Failed to send reschedule-approved portal message"));
  }

  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/dismiss-reschedule-request — staff declines a portal reschedule request
// ---------------------------------------------------------------------------
router.post("/jobs/:id/dismiss-reschedule-request", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Office/admin role required to dismiss reschedule requests" });
    return;
  }

  const { reply } = req.body as { reply?: string };

  // Atomic claim: only declines a job that is still in the pending state.
  // Concurrent approvals or double-declines both get 0 rows → 409.
  const [updated] = await db
    .update(jobsTable)
    .set({
      rescheduleRequestStatus: "declined",
      rescheduleRequestReply: reply?.trim() || null,
    } as any)
    .where(
      and(
        eq(jobsTable.id, id),
        eq(jobsTable.tenantId, tenantId),
        isNotNull((jobsTable as any).rescheduleRequestedAt),
        or(
          isNull((jobsTable as any).rescheduleRequestStatus),
          eq((jobsTable as any).rescheduleRequestStatus, "pending"),
        ),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "No pending reschedule request on this job, or it was already processed" });
    return;
  }

  // Notify customer via portal message (fire-and-forget)
  if (updated.customerId) {
    const body = reply?.trim()
      ? `Your reschedule request for "${updated.title}" was not approved. ${reply.trim()}`
      : `Your reschedule request for "${updated.title}" was not approved. Your job remains scheduled — please contact us if you have questions.`;
    db.insert(portalMessagesTable)
      .values({ tenantId, customerId: updated.customerId, direction: "outbound", body })
      .catch(err => logger.error({ err, jobId: id }, "Failed to send reschedule-declined portal message"));
  }

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
    .where(and(
      eq(jobsTable.id, id),
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
    ))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const result = await resendReminderForJob(tenantId, id, reminderType);
  res.json(result);
});

export default router;
