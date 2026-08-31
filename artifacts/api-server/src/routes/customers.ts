import { Router, type IRouter } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, estimatesTable, activityLogTable, propertyOwnershipHistoryTable, customerOtpSessionsTable, stopServiceFlagsTable, communicationsLogTable, tenantsTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, isNull, ne, inArray } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { syncCustomerToMailchimp } from "../lib/mailchimpSync";
import { isAdminRole } from "../lib/roles";
import { getStripeClient } from "../lib/stripe";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";
import { invalidateTenantReportCache } from "../lib/reportsCache";
import { geocodeAddress } from "./properties";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalBoolean,
  registerImportExportConfig,
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();
const CUSTOMER_REFERRAL_SOURCE = "customer_referral";

async function validateReferringCustomer(
  tenantId: number,
  referringCustomerId: unknown,
  currentCustomerId?: number,
): Promise<{ id: number; name: string } | null> {
  if (referringCustomerId === undefined || referringCustomerId === null || referringCustomerId === "") return null;
  const id = Number(referringCustomerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Referring customer must be a valid customer");
  if (currentCustomerId !== undefined && id === currentCustomerId) throw new Error("A customer cannot refer themselves");
  const [customer] = await db.select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
    .limit(1);
  if (!customer) throw new Error("Referring customer was not found for this business");
  return customer;
}

async function requireAdmin(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const customersImportExportConfig: ImportExportEntityConfig = {
  entityKey: "customers",
  fields: [
    { key: "name", header: "Name", hint: "Use this when first and last name are together in one column" },
    { key: "firstName", header: "First Name", hint: "Use with Last Name when names are in separate columns" },
    { key: "lastName", header: "Last Name", hint: "Use with First Name when names are in separate columns" },
    { key: "email", header: "Email", required: true, hint: "Used to match existing customers" },
    { key: "phone", header: "Phone", required: true },
    { key: "secondaryPhone", header: "Secondary Phone" },
    { key: "company", header: "Company" },
    { key: "customerType", header: "Customer Type" },
    { key: "referralSource", header: "Referral Source" },
    { key: "referringCustomerEmail", header: "Referring Customer Email", hint: "Required when Referral Source is customer_referral" },
    { key: "billingAddress", header: "Billing Address" },
    { key: "billingCity", header: "Billing City" },
    { key: "billingState", header: "Billing State" },
    { key: "billingZip", header: "Billing Zip" },
    { key: "physicalAddress", header: "Physical Address" },
    { key: "physicalCity", header: "Physical City" },
    { key: "physicalState", header: "Physical State" },
    { key: "physicalZip", header: "Physical Zip" },
    { key: "notes", header: "Notes" },
    { key: "tags", header: "Tags", hint: "Comma-separated" },
    { key: "smsOptOut", header: "SMS Opt Out", hint: "true/false" },
    { key: "emailOptOut", header: "Email Opt Out", hint: "true/false" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "name", header: "Name" },
    { key: "email", header: "Email" },
    { key: "phone", header: "Phone" },
    { key: "secondaryPhone", header: "Secondary Phone" },
    { key: "company", header: "Company" },
    { key: "customerType", header: "Customer Type" },
    { key: "referralSource", header: "Referral Source" },
    { key: "referringCustomerEmail", header: "Referring Customer Email" },
    { key: "billingAddress", header: "Billing Address" },
    { key: "billingCity", header: "Billing City" },
    { key: "billingState", header: "Billing State" },
    { key: "billingZip", header: "Billing Zip" },
    { key: "physicalAddress", header: "Physical Address" },
    { key: "physicalCity", header: "Physical City" },
    { key: "physicalState", header: "Physical State" },
    { key: "physicalZip", header: "Physical Zip" },
    { key: "notes", header: "Notes" },
    { key: "tags", header: "Tags" },
    { key: "totalSpend", header: "Total Spend" },
    { key: "smsOptOut", header: "SMS Opt Out" },
    { key: "emailOptOut", header: "Email Opt Out" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    const baseWhere = eq(customersTable.tenantId, tenantId);
    const where = query.q ? and(baseWhere, ilike(customersTable.name, `%${query.q}%`)) : baseWhere;
    const rows = await db.select().from(customersTable).where(where).orderBy(customersTable.createdAt);
    const referrerIds = rows.map((customer) => customer.referringCustomerId).filter((value): value is number => value !== null);
    const referrers = referrerIds.length > 0
      ? await db.select({ id: customersTable.id, email: customersTable.email }).from(customersTable)
          .where(and(eq(customersTable.tenantId, tenantId), inArray(customersTable.id, referrerIds)))
      : [];
    const emailById = new Map(referrers.map((customer) => [customer.id, customer.email]));
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      secondaryPhone: c.secondaryPhone ?? "",
      company: c.company ?? "",
      customerType: c.customerType ?? "",
      referralSource: c.referralSource ?? "",
      referringCustomerEmail: c.referringCustomerId ? emailById.get(c.referringCustomerId) ?? "" : "",
      billingAddress: c.billingAddress ?? "",
      billingCity: c.billingCity ?? "",
      billingState: c.billingState ?? "",
      billingZip: c.billingZip ?? "",
      physicalAddress: c.physicalAddress ?? "",
      physicalCity: c.physicalCity ?? "",
      physicalState: c.physicalState ?? "",
      physicalZip: c.physicalZip ?? "",
      notes: c.notes ?? "",
      tags: (c.tags ?? []).join("; "),
      totalSpend: c.totalSpend,
      smsOptOut: c.smsOptOut,
      emailOptOut: c.emailOptOut,
      createdAt: c.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const combinedName = optionalString(raw.name);
    const firstName = optionalString(raw.firstName);
    const lastName = optionalString(raw.lastName);
    const name = combinedName ?? [firstName, lastName].filter(Boolean).join(" ");
    if (!name) errors.push("Name is required (map Name, or map both First Name and Last Name)");
    const email = requireString(raw.email, "Email", errors);
    const phone = requireString(raw.phone, "Phone", errors);
    if (errors.length > 0 || !name || !email || !phone) return { ok: false, errors };

    const tags = raw.tags ? raw.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
    const referralSource = optionalString(raw.referralSource) ?? null;
    const referringCustomerEmail = optionalString(raw.referringCustomerEmail);
    if (referringCustomerEmail?.toLowerCase() === email.toLowerCase()) {
      errors.push("A customer cannot refer themselves");
    }
    let referringCustomerId: number | null = null;
    if (referringCustomerEmail) {
      const [referrer] = await db.select({ id: customersTable.id }).from(customersTable)
        .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${referringCustomerEmail})`))
        .limit(1);
      if (!referrer) errors.push("Referring Customer Email must match a customer in this business");
      else referringCustomerId = referrer.id;
    }
    if (referralSource === CUSTOMER_REFERRAL_SOURCE && !referringCustomerId) {
      errors.push("Referring Customer Email is required for customer_referral");
    }
    if (referringCustomerId && referralSource !== CUSTOMER_REFERRAL_SOURCE) {
      errors.push("Referral Source must be customer_referral when a referring customer is supplied");
    }
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      values: {
        name,
        email: email.toLowerCase(),
        phone,
        secondaryPhone: optionalString(raw.secondaryPhone) ?? null,
        company: optionalString(raw.company) ?? null,
        customerType: optionalString(raw.customerType) ?? null,
        referralSource,
        referringCustomerId,
        billingAddress: optionalString(raw.billingAddress) ?? null,
        billingCity: optionalString(raw.billingCity) ?? null,
        billingState: optionalString(raw.billingState) ?? null,
        billingZip: optionalString(raw.billingZip) ?? null,
        physicalAddress: optionalString(raw.physicalAddress) ?? null,
        physicalCity: optionalString(raw.physicalCity) ?? null,
        physicalState: optionalString(raw.physicalState) ?? null,
        physicalZip: optionalString(raw.physicalZip) ?? null,
        notes: optionalString(raw.notes) ?? null,
        tags,
        smsOptOut: optionalBoolean(raw.smsOptOut) ?? false,
        emailOptOut: optionalBoolean(raw.emailOptOut) ?? false,
      },
    };
  },
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${values.email as string})`))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const [row] = await db.insert(customersTable).values({ tenantId, ...values } as typeof customersTable.$inferInsert).returning({ id: customersTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    await db.update(customersTable).set(values as Partial<typeof customersTable.$inferInsert>)
      .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  },
  getDependents: async (tenantId, id) => {
    const [jobRow] = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.customerId, id)));
    const [invoiceRow] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id)));
    const [propRow] = await db.select({ count: sql<number>`count(*)` }).from(propertiesTable).where(and(eq(propertiesTable.tenantId, tenantId), eq(propertiesTable.customerId, id)));
    const jobCount = Number(jobRow?.count ?? 0);
    const invoiceCount = Number(invoiceRow?.count ?? 0);
    const propCount = Number(propRow?.count ?? 0);
    const parts: string[] = [];
    if (jobCount > 0) parts.push(`${jobCount} job${jobCount === 1 ? "" : "s"}`);
    if (invoiceCount > 0) parts.push(`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`);
    if (propCount > 0) parts.push(`${propCount} propert${propCount === 1 ? "y" : "ies"}`);
    return parts.length > 0 ? `still has ${parts.join(", ")} — delete those first, then undo this import again` : null;
  },
};
registerImportExportConfig(customersImportExportConfig);

router.get("/customers/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), customersImportExportConfig);
});

router.post("/customers/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), customersImportExportConfig);
});

router.post("/customers/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), customersImportExportConfig);
});

type PaymentStanding = {
  status: "current" | "reminded" | "overdue" | "flagged" | "paused";
  oldestOverdueInvoiceId: number | null;
  daysOverdue: number | null;
  overdueAmount: number;
  pendingFlagId: number | null;
  isServicePaused: boolean;
};

/** Computes a customer's payment standing from existing invoice/flag/job data — nothing is duplicated in storage. */
async function computePaymentStanding(tenantId: number, customerId: number): Promise<PaymentStanding> {
  const now = new Date();

  const [overdueInvoices, [pendingFlag], [pausedJob]] = await Promise.all([
    db.select().from(invoicesTable).where(and(
      eq(invoicesTable.tenantId, tenantId),
      eq(invoicesTable.customerId, customerId),
      ne(invoicesTable.status, "paid"),
      sql`${invoicesTable.dueDate} IS NOT NULL AND ${invoicesTable.dueDate} < ${now.toISOString()}::timestamptz`,
    )).orderBy(invoicesTable.dueDate),
    db.select().from(stopServiceFlagsTable).where(and(
      eq(stopServiceFlagsTable.tenantId, tenantId),
      eq(stopServiceFlagsTable.customerId, customerId),
      eq(stopServiceFlagsTable.status, "pending"),
    )).limit(1),
    db.select().from(jobsTable).where(and(
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.customerId, customerId),
      isNull(jobsTable.recurrenceParentId),
      eq(jobsTable.isRecurrencePaused, true),
    )).limit(1),
  ]);

  const overdueAmount = overdueInvoices.reduce((sum, i) => sum + i.total, 0);
  const oldest = overdueInvoices[0] ?? null;
  const daysOverdue = oldest?.dueDate ? Math.floor((now.getTime() - oldest.dueDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const remindersSent = (oldest?.paymentRemindersSent as number[] | null) ?? [];

  let status: PaymentStanding["status"] = "current";
  if (pausedJob) status = "paused";
  else if (pendingFlag) status = "flagged";
  else if (oldest) status = remindersSent.length > 0 ? "reminded" : "overdue";

  return {
    status,
    oldestOverdueInvoiceId: oldest?.id ?? null,
    daysOverdue,
    overdueAmount,
    pendingFlagId: pendingFlag?.id ?? null,
    isServicePaused: !!pausedJob,
  };
}

type LastReminderFailure = {
  channel: string;
  errorNote: string;
  failedAt: string;
} | null;

function formatCustomer(
  c: typeof customersTable.$inferSelect,
  extras?: { propertyCount?: number; createdPropertyId?: number; thisYearSpend?: number; lastYearSpend?: number; paymentStanding?: PaymentStanding; lastReminderFailure?: LastReminderFailure; referringCustomerName?: string | null }
) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    secondaryPhone: c.secondaryPhone ?? null,
    company: c.company ?? null,
    customerType: c.customerType ?? null,
    referralSource: c.referralSource ?? null,
    referringCustomerId: c.referringCustomerId ?? null,
    referringCustomerName: extras?.referringCustomerName ?? null,
    billingAddress: c.billingAddress ?? null,
    billingCity: c.billingCity ?? null,
    billingState: c.billingState ?? null,
    billingZip: c.billingZip ?? null,
    physicalAddress: c.physicalAddress ?? null,
    physicalCity: c.physicalCity ?? null,
    physicalState: c.physicalState ?? null,
    physicalZip: c.physicalZip ?? null,
    notes: c.notes ?? null,
    tags: c.tags ?? [],
    customFieldValues: (c.customFieldValues as Record<string, unknown>) ?? {},
    totalSpend: c.totalSpend,
    acquiredFromCampaignId: c.acquiredFromCampaignId ?? null,
    smsOptOut: c.smsOptOut ?? false,
    emailOptOut: c.emailOptOut ?? false,
    autoInvoiceOnCompletion: c.autoInvoiceOnCompletion ?? false,
    profilePhotoUrl: c.profilePhotoUrl ?? null,
    thisYearSpend: extras?.thisYearSpend ?? null,
    lastYearSpend: extras?.lastYearSpend ?? null,
    propertyCount: extras?.propertyCount ?? 0,
    ...(extras?.createdPropertyId !== undefined ? { createdPropertyId: extras.createdPropertyId } : {}),
    paymentStanding: extras?.paymentStanding ?? null,
    lastReminderFailure: extras?.lastReminderFailure ?? null,
    hasPaymentMethod: !!c.stripeDefaultPaymentMethodId,
    noCardAlertSilenced: c.noCardAlertSilenced ?? false,
    cardExpiresAt: c.cardExpiresAt ?? null,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Fetch the most recent failed outbound reminder comms-log entry for each of the given customer IDs.
 * Returns a map of customerId → LastReminderFailure.
 */
async function fetchLastReminderFailures(tenantId: number, customerIds: number[]): Promise<Map<number, LastReminderFailure>> {
  if (customerIds.length === 0) return new Map();

  // Use DISTINCT ON to get the latest failure per customer
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (customer_id)
      customer_id,
      channel,
      error_note,
      created_at
    FROM communications_log
    WHERE tenant_id = ${tenantId}
      AND customer_id = ANY(${sql.raw(`ARRAY[${customerIds.join(",")}]`)}::int[])
      AND direction = 'outbound'
      AND status = 'failed'
      AND message_type IN ('reminder_7d', 'reminder_24h')
    ORDER BY customer_id, created_at DESC
  `) as unknown as { rows: Array<{ customer_id: number; channel: string; error_note: string | null; created_at: Date }> };

  const map = new Map<number, LastReminderFailure>();
  for (const row of rows.rows) {
    map.set(row.customer_id, {
      channel: row.channel,
      errorNote: row.error_note ?? "Unknown error",
      failedAt: new Date(row.created_at).toISOString(),
    });
  }
  return map;
}

router.get("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { q, page = "1", limit = "20", hasReminderFailure, includeArchived } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const baseWhere = includeArchived === "true"
    ? eq(customersTable.tenantId, tenantId)
    : and(eq(customersTable.tenantId, tenantId), isNull(customersTable.archivedAt));
  let where = q ? and(baseWhere, ilike(customersTable.name, `%${q}%`)) : baseWhere;

  // If filtering by reminder failure, restrict to customers whose MOST RECENT outbound reminder attempt failed.
  // Using a subquery with DISTINCT ON so a later successful send clears the badge.
  if (hasReminderFailure === "true") {
    const failedCustomerIds = await db.execute(sql`
      SELECT customer_id FROM (
        SELECT DISTINCT ON (customer_id)
          customer_id,
          status
        FROM communications_log
        WHERE tenant_id = ${tenantId}
          AND direction = 'outbound'
          AND message_type IN ('reminder_7d', 'reminder_24h')
        ORDER BY customer_id, created_at DESC
      ) latest
      WHERE status = 'failed'
    `) as unknown as { rows: Array<{ customer_id: number }> };
    const ids = failedCustomerIds.rows.map(r => r.customer_id).filter((id): id is number => id !== null);
    if (ids.length === 0) {
      res.json({ items: [], total: 0, page: pageNum, limit: limitNum });
      return;
    }
    where = and(where, inArray(customersTable.id, ids));
  }

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

  const referrerIds = rows.map((row) => row.referringCustomerId).filter((value): value is number => value !== null);
  const [propCounts, failureMap, lastServiceRows, referrers] = await Promise.all([
    db
      .select({ customerId: propertiesTable.customerId, count: sql<number>`count(*)::int` })
      .from(propertiesTable)
      .where(eq(propertiesTable.tenantId, tenantId))
      .groupBy(propertiesTable.customerId),
    fetchLastReminderFailures(tenantId, rows.map(r => r.id)),
    db
      .select({ customerId: jobsTable.customerId, lastDate: sql<string>`max(${jobsTable.scheduledAt})` })
      .from(jobsTable)
      .where(and(eq(jobsTable.tenantId, tenantId), inArray(jobsTable.customerId, rows.map(r => r.id)), eq(jobsTable.status, 'completed')))
      .groupBy(jobsTable.customerId),
    referrerIds.length > 0
      ? db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable)
          .where(and(eq(customersTable.tenantId, tenantId), inArray(customersTable.id, referrerIds)))
      : Promise.resolve([]),
  ]);

  const propMap = Object.fromEntries(propCounts.map(p => [p.customerId, p.count]));
  const lastServiceMap = Object.fromEntries(lastServiceRows.map(r => [r.customerId, r.lastDate]));
  const referrerMap = Object.fromEntries(referrers.map(r => [r.id, r.name]));

  res.json({
    items: rows.map(c => ({ ...formatCustomer(c, {
      propertyCount: propMap[c.id] ?? 0,
      lastReminderFailure: failureMap.get(c.id) ?? null,
      referringCustomerName: c.referringCustomerId ? referrerMap[c.referringCustomerId] ?? null : null,
    }), lastServiceDate: lastServiceMap[c.id] ?? null })),
    total: count,
    page: pageNum,
    limit: limitNum,
  });
});

router.post("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const {
    name, email, phone, secondaryPhone, company, customerType, referralSource, referringCustomerId,
    billingAddress, billingCity, billingState, billingZip,
    physicalAddress, physicalCity, physicalState, physicalZip, physicalLat, physicalLng, physicalPropertyType,
    notes, tags, customFieldValues,
    acquiredFromCampaignId,
  } = req.body;
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim() || typeof phone !== "string" || !phone.trim()) {
    res.status(400).json({ error: "name, email, and phone are required" });
    return;
  }

  if (physicalAddress !== undefined && (typeof physicalAddress !== "string" || !physicalAddress.trim())) {
    res.status(400).json({ error: "physicalAddress must be a non-empty string when provided" });
    return;
  }
  const hasPhysicalCoordinates = physicalLat !== undefined || physicalLng !== undefined;
  if (hasPhysicalCoordinates && !physicalAddress) {
    res.status(400).json({ error: "physicalLat and physicalLng require physicalAddress" });
    return;
  }
  if (hasPhysicalCoordinates && (physicalLat === undefined || physicalLng === undefined
    || !Number.isFinite(Number(physicalLat)) || !Number.isFinite(Number(physicalLng)))) {
    res.status(400).json({ error: "physicalLat and physicalLng must both be finite numbers" });
    return;
  }
  if (physicalPropertyType !== undefined && (typeof physicalPropertyType !== "string" || !physicalPropertyType.trim())) {
    res.status(400).json({ error: "physicalPropertyType must be a non-empty string when provided" });
    return;
  }
  let referrer: { id: number; name: string } | null;
  try {
    referrer = await validateReferringCustomer(tenantId, referringCustomerId);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  if (referralSource === CUSTOMER_REFERRAL_SOURCE && !referrer) {
    res.status(400).json({ error: "A referring customer is required for customer referrals" });
    return;
  }
  if (referrer && referralSource !== CUSTOMER_REFERRAL_SOURCE) {
    res.status(400).json({ error: "Referral source must be customer_referral when a referring customer is selected" });
    return;
  }

  let physicalCoordinates: { lat: number; lng: number } | null = null;
  if (physicalAddress) {
    physicalCoordinates = hasPhysicalCoordinates
      ? { lat: Number(physicalLat), lng: Number(physicalLng) }
      : await geocodeAddress(physicalAddress, physicalCity, physicalState, physicalZip);
  }

  const { customer, createdPropertyId } = await db.transaction(async (tx) => {
    const [createdCustomer] = await tx.insert(customersTable).values({
      tenantId, name, email, phone,
      secondaryPhone: secondaryPhone ?? null, company: company ?? null, customerType: customerType ?? null,
      referralSource: referralSource ?? null, billingAddress: billingAddress ?? null, billingCity: billingCity ?? null,
      referringCustomerId: referrer?.id ?? null,
      billingState: billingState ?? null, billingZip: billingZip ?? null,
      physicalAddress: physicalAddress ?? null, physicalCity: physicalCity ?? null,
      physicalState: physicalState ?? null, physicalZip: physicalZip ?? null,
      notes: notes ?? null, tags: tags ?? [], customFieldValues: customFieldValues ?? {},
      acquiredFromCampaignId: acquiredFromCampaignId ? parseInt(acquiredFromCampaignId, 10) : null,
    }).returning();
    if (!physicalAddress) return { customer: createdCustomer, createdPropertyId: undefined };
    const [property] = await tx.insert(propertiesTable).values({
      tenantId, customerId: createdCustomer.id, address: physicalAddress.trim(),
      city: physicalCity ?? null, state: physicalState ?? null, zip: physicalZip ?? null,
      lat: physicalCoordinates?.lat ?? null, lng: physicalCoordinates?.lng ?? null,
      type: physicalPropertyType?.trim() || "residential",
    }).returning({ id: propertiesTable.id });
    return { customer: createdCustomer, createdPropertyId: property.id };
  });

  await db.insert(activityLogTable).values({ tenantId, userId, type: "customer_added", message: `New customer "${name}" added`, entityId: customer.id });
  void syncCustomerToMailchimp(tenantId, customer);

  res.status(201).json(formatCustomer(customer, { propertyCount: createdPropertyId ? 1 : 0, createdPropertyId, referringCustomerName: referrer?.name ?? null }));
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const now = new Date();
  const thisYearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
  const lastYearEnd = new Date(now.getFullYear(), 0, 1).toISOString();

  const [
    [{ count: propCount }],
    [thisYear],
    [lastYear],
    paymentStanding,
    failureMap,
    referrer,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
      .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId))),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${thisYearStart}::timestamptz`)),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${lastYearStart}::timestamptz AND created_at < ${lastYearEnd}::timestamptz`)),
    computePaymentStanding(tenantId, id),
    fetchLastReminderFailures(tenantId, [id]),
    customer.referringCustomerId
      ? db.select({ name: customersTable.name }).from(customersTable)
          .where(and(eq(customersTable.id, customer.referringCustomerId), eq(customersTable.tenantId, tenantId))).limit(1)
      : Promise.resolve([]),
  ]);

  res.json(formatCustomer(customer, {
    propertyCount: propCount,
    thisYearSpend: thisYear?.total ?? 0,
    lastYearSpend: lastYear?.total ?? 0,
    paymentStanding,
    lastReminderFailure: failureMap.get(id) ?? null,
    referringCustomerName: referrer[0]?.name ?? null,
  }));
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const {
    name, email, phone, secondaryPhone, company, customerType, referralSource, referringCustomerId,
    billingAddress, billingCity, billingState, billingZip, physicalAddress, physicalCity, physicalState, physicalZip, notes, tags, customFieldValues,
    acquiredFromCampaignId, smsOptOut, emailOptOut, archivedAt,
  } = req.body;

  const [existing] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const nextReferralSource = referralSource !== undefined ? referralSource : existing.referralSource;
  const nextReferringCustomerId = referringCustomerId !== undefined
    ? referringCustomerId
    : (referralSource !== undefined && referralSource !== CUSTOMER_REFERRAL_SOURCE ? null : existing.referringCustomerId);
  let referrer: { id: number; name: string } | null;
  try {
    referrer = await validateReferringCustomer(tenantId, nextReferringCustomerId, id);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  if (nextReferralSource === CUSTOMER_REFERRAL_SOURCE && !referrer) {
    res.status(400).json({ error: "A referring customer is required for customer referrals" });
    return;
  }
  if (referrer && nextReferralSource !== CUSTOMER_REFERRAL_SOURCE) {
    res.status(400).json({ error: "Referral source must be customer_referral when a referring customer is selected" });
    return;
  }

  const updates: Partial<typeof customersTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phone) updates.phone = phone;
  if (secondaryPhone !== undefined) updates.secondaryPhone = secondaryPhone;
  if (company !== undefined) updates.company = company;
  if (customerType !== undefined) updates.customerType = customerType;
  if (referralSource !== undefined) updates.referralSource = referralSource;
  if (referralSource !== undefined || referringCustomerId !== undefined) updates.referringCustomerId = referrer?.id ?? null;
  if (billingAddress !== undefined) updates.billingAddress = billingAddress;
  if (billingCity !== undefined) updates.billingCity = billingCity;
  if (billingState !== undefined) updates.billingState = billingState;
  if (billingZip !== undefined) updates.billingZip = billingZip;
  if (physicalAddress !== undefined) updates.physicalAddress = physicalAddress;
  if (physicalCity !== undefined) updates.physicalCity = physicalCity;
  if (physicalState !== undefined) updates.physicalState = physicalState;
  if (physicalZip !== undefined) updates.physicalZip = physicalZip;
  if (notes !== undefined) updates.notes = notes;
  if (tags !== undefined) updates.tags = tags;
  if (customFieldValues !== undefined) updates.customFieldValues = customFieldValues;
  if (acquiredFromCampaignId !== undefined) {
    updates.acquiredFromCampaignId = acquiredFromCampaignId ? parseInt(acquiredFromCampaignId, 10) : null;
  }
  if (smsOptOut !== undefined) updates.smsOptOut = smsOptOut;
  if (emailOptOut !== undefined) updates.emailOptOut = emailOptOut;
  const { autoInvoiceOnCompletion, noCardAlertSilenced } = req.body;
  if (autoInvoiceOnCompletion !== undefined) updates.autoInvoiceOnCompletion = autoInvoiceOnCompletion;
  if (noCardAlertSilenced !== undefined) updates.noCardAlertSilenced = noCardAlertSilenced;
  if (archivedAt !== undefined) {
    if (!await requireAdmin(req, res)) return;
    if (archivedAt !== null && (
      typeof archivedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(archivedAt)
      || Number.isNaN(Date.parse(archivedAt))
    )) {
      res.status(400).json({ error: "archivedAt must be an ISO timestamp string or null" });
      return;
    }
  }

  const [updated] = await db.transaction(async (tx) => {
    if (archivedAt !== undefined) {
      const lockedRows = await tx.execute(sql`
        SELECT archived_at
        FROM customers
        WHERE id = ${id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `);
      const lockedCustomer = lockedRows.rows[0] as { archived_at: Date | null } | undefined;
      const currentArchivedAt = lockedCustomer?.archived_at
        ? new Date(lockedCustomer.archived_at)
        : null;
      const isArchiving = archivedAt !== null;
      const archiveStateChanged = isArchiving !== (currentArchivedAt !== null);

      if (archiveStateChanged && isArchiving) {
        const cascadeArchivedAt = new Date(archivedAt);
        updates.archivedAt = cascadeArchivedAt;
        await Promise.all([
          tx.update(estimatesTable)
            .set({ isArchived: true, archivedAt: cascadeArchivedAt })
            .where(and(
              eq(estimatesTable.tenantId, tenantId),
              eq(estimatesTable.customerId, id),
              isNull(estimatesTable.archivedAt),
            )),
          tx.update(invoicesTable)
            .set({ archivedAt: cascadeArchivedAt })
            .where(and(
              eq(invoicesTable.tenantId, tenantId),
              eq(invoicesTable.customerId, id),
              isNull(invoicesTable.archivedAt),
            )),
          tx.update(jobsTable)
            .set({ archivedAt: cascadeArchivedAt })
            .where(and(
              eq(jobsTable.tenantId, tenantId),
              eq(jobsTable.customerId, id),
              isNull(jobsTable.archivedAt),
            )),
        ]);
      } else if (archiveStateChanged && currentArchivedAt) {
        updates.archivedAt = null;
        await Promise.all([
          tx.update(estimatesTable)
            .set({ isArchived: false, archivedAt: null })
            .where(and(
              eq(estimatesTable.tenantId, tenantId),
              eq(estimatesTable.customerId, id),
              eq(estimatesTable.archivedAt, currentArchivedAt),
            )),
          tx.update(invoicesTable)
            .set({ archivedAt: null })
            .where(and(
              eq(invoicesTable.tenantId, tenantId),
              eq(invoicesTable.customerId, id),
              eq(invoicesTable.archivedAt, currentArchivedAt),
            )),
          tx.update(jobsTable)
            .set({ archivedAt: null })
            .where(and(
              eq(jobsTable.tenantId, tenantId),
              eq(jobsTable.customerId, id),
              eq(jobsTable.archivedAt, currentArchivedAt),
            )),
        ]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return tx.select()
        .from(customersTable)
        .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
        .limit(1);
    }

    return tx.update(customersTable)
      .set(updates)
      .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
      .returning();
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (archivedAt !== undefined) invalidateTenantReportCache(tenantId);
  if (tags !== undefined) void syncCustomerToMailchimp(tenantId, updated);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
    .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));
  res.json(formatCustomer(updated, { propertyCount: count, referringCustomerName: referrer?.name ?? null }));
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (!await requireAdmin(req, res)) return;
  const [[{ propertyCount }], [{ jobCount }], [{ invoiceCount }]] = await Promise.all([
    db.select({ propertyCount: sql<number>`count(*)::int` }).from(propertiesTable)
      .where(and(eq(propertiesTable.tenantId, tenantId), eq(propertiesTable.customerId, id))),
    db.select({ jobCount: sql<number>`count(*)::int` }).from(jobsTable)
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.customerId, id))),
    db.select({ invoiceCount: sql<number>`count(*)::int` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id))),
  ]);
  if (jobCount > 0 || invoiceCount > 0) {
    res.status(409).json({ error: "Cannot permanently delete customer because related jobs or invoices still exist. Delete those first, then try again." });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      if (propertyCount > 0) {
        const propertyIds = await tx.select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(and(eq(propertiesTable.tenantId, tenantId), eq(propertiesTable.customerId, id)));
        if (propertyIds.length > 0) {
          await tx.delete(propertiesTable)
            .where(and(
              eq(propertiesTable.tenantId, tenantId),
              inArray(propertiesTable.id, propertyIds.map((property) => property.id)),
            ));
        }
      }
      await tx.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23503") {
      res.status(409).json({ error: "Cannot permanently delete this customer because its properties still have related jobs, estimates, or other records. Remove those records first, then try again." });
      return;
    }
    throw error;
  }
  res.sendStatus(204);
});

// ── SEND CARD-SETUP LINK VIA SMS ─────────────────────────────────────────────

/** Text the customer a link to their portal profile so they can add a card. */
router.post("/customers/:id/send-card-link", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [[customer], [tenant]] = await Promise.all([
    db.select().from(customersTable)
      .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId))),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)),
  ]);
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  if (!customer.phone) { res.status(400).json({ error: "Customer has no phone number on file" }); return; }

  // Build the portal URL from request host so it works in both dev and production
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? (req.headers.host as string | undefined) ?? "";
  const portalUrl = `${proto}://${host}/portal/profile`;

  const firstName = customer.name?.split(" ")[0] ?? "there";
  const businessName = tenant?.name ?? "your service provider";
  const message = `Hi ${firstName}! ${businessName} is requesting a payment method on file. You can securely add your card at: ${portalUrl}`;

  const smsConfig: SmsProviderConfig = {
    platform: (tenant?.phonePlatform as SmsProviderConfig["platform"]) ?? null,
    config: (tenant?.phonePlatformConfig as Record<string, string>) ?? {},
    fromNumber: tenant?.mainPhoneNumber ?? null,
  };

  const result = await sendSms(smsConfig, customer.phone, message);
  if (!result.success) {
    res.status(500).json({ error: result.error ?? "Failed to send SMS" });
    return;
  }
  res.json({ success: true });
});

// Return the Stripe publishable key so the frontend can mount Elements
router.get("/stripe/config", async (_req, res): Promise<void> => {
  const { getStripePublishableKey } = await import("../lib/stripe");
  const key = getStripePublishableKey();
  res.json({ publishableKey: key ?? null });
});

// ── PAYMENT SETUP / ATTACH ────────────────────────────────────────────────────

/** Create a Stripe SetupIntent so the frontend can collect and save a card. */
router.post("/customers/:id/setup-intent", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const stripe = getStripeClient();
  if (!stripe) { res.status(503).json({ error: "Stripe is not configured" }); return; }

  const { ensureStripeCustomer, getStripePublishableKey } = await import("../lib/stripe");
  const stripeCustomerId = await ensureStripeCustomer(id, customer.name, customer.email, customer.stripeCustomerId);

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) { res.status(503).json({ error: "Stripe publishable key is not configured" }); return; }

  res.json({ clientSecret: setupIntent.client_secret, publishableKey });
});

/** Attach a confirmed Stripe PaymentMethod ID to a customer. */
router.post("/customers/:id/attach-payment-method", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { paymentMethodId } = req.body;
  if (!paymentMethodId) { res.status(400).json({ error: "paymentMethodId is required" }); return; }

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const stripe = getStripeClient();
  if (!stripe) { res.status(503).json({ error: "Stripe is not configured" }); return; }

  const { ensureStripeCustomer } = await import("../lib/stripe");
  const stripeCustomerId = await ensureStripeCustomer(id, customer.name, customer.email, customer.stripeCustomerId);

  // Retrieve the PM to validate expiry BEFORE attaching
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (!pm.card) { res.status(400).json({ error: "Only card payment methods are supported" }); return; }

  // Card must not expire within 3 months from today
  const now = new Date();
  const threeMonthsLater = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  const cardExpiry = new Date(pm.card.exp_year, pm.card.exp_month, 0); // last day of expiry month
  if (cardExpiry < threeMonthsLater) {
    const exp = `${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}`;
    res.status(400).json({ error: `This card expires ${exp}. Please use a card with at least 3 months remaining.` });
    return;
  }

  // Attach the payment method to the Stripe customer and set as default
  await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const [updated] = await db.update(customersTable)
    .set({
      stripeDefaultPaymentMethodId: paymentMethodId,
      cardExpiresAt: cardExpiry.toISOString().split("T")[0],
      cardExpiryReminderSentAt: null,
    })
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
    .returning();

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
    .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));
  res.json(formatCustomer(updated, { propertyCount: count }));
});

// ── PAYMENT METHOD ────────────────────────────────────────────────────────────
router.get("/customers/:id/payment-method", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  if (!customer.stripeDefaultPaymentMethodId) {
    res.json({ paymentMethod: null });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.json({ paymentMethod: null });
    return;
  }

  try {
    const pm = await stripe.paymentMethods.retrieve(customer.stripeDefaultPaymentMethodId);
    if (pm.type === "card" && pm.card) {
      res.json({
        paymentMethod: {
          type: "card",
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
          label: `${pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1)} •••• ${pm.card.last4}`,
        },
      });
    } else if (pm.type === "us_bank_account" && pm.us_bank_account) {
      res.json({
        paymentMethod: {
          type: "bank",
          bankName: pm.us_bank_account.bank_name ?? "Bank",
          last4: pm.us_bank_account.last4,
          label: `${pm.us_bank_account.bank_name ?? "Bank"} •••• ${pm.us_bank_account.last4}`,
        },
      });
    } else {
      res.json({ paymentMethod: { type: pm.type, label: pm.type } });
    }
  } catch {
    res.json({ paymentMethod: null });
  }
});

// Remove saved payment method from a customer
router.delete("/customers/:id/payment-method", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  if (!customer.stripeDefaultPaymentMethodId) {
    res.status(400).json({ error: "Customer has no saved payment method" });
    return;
  }

  // Attempt to detach from Stripe (best-effort; still clear our record even if Stripe fails)
  const stripe = getStripeClient();
  if (stripe) {
    try {
      await stripe.paymentMethods.detach(customer.stripeDefaultPaymentMethodId);
    } catch (err) {
      // Log but don't block — we'll still clear our reference
      logger.warn({ err, customerId: id }, "Stripe detach failed; clearing local reference anyway");
    }
  }

  await db.update(customersTable)
    .set({ stripeDefaultPaymentMethodId: null, cardExpiresAt: null, cardExpiryReminderSentAt: null })
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));

  res.json({ success: true });
});

// ── SEND CARD EXPIRY REMINDER ─────────────────────────────────────────────────

/** Send a one-off card expiry reminder to a specific customer and record the send time. */
router.post("/customers/:id/send-expiry-reminder", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [[customer], [tenant]] = await Promise.all([
    db.select().from(customersTable)
      .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId))),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)),
  ]);
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  if (customer.archivedAt) {
    res.status(409).json({ error: "Archived customers cannot receive reminders" });
    return;
  }
  if (!customer.stripeDefaultPaymentMethodId) {
    res.status(400).json({ error: "Customer has no saved card" }); return;
  }

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? (req.headers.host as string | undefined) ?? "";
  const portalUrl = `${proto}://${host}/portal/profile`;
  const businessName = tenant?.name ?? "your service provider";
  const expLabel = customer.cardExpiresAt
    ? ` (expiring ${new Date(customer.cardExpiresAt).toLocaleString("en-US", { month: "long", year: "numeric" })})`
    : "";
  const firstName = customer.name?.split(" ")[0] ?? "there";

  const sent: string[] = [];

  // Email
  if (!customer.emailOptOut && customer.email) {
    const emailConfig: EmailProviderConfig = {
      provider: (tenant?.emailProvider as EmailProviderConfig["provider"]) ?? null,
      config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    const html = `<p>Hi ${firstName},</p><p>The payment card${expLabel} we have on file for your account is expiring soon. Please log in to update your card to avoid any service interruptions.</p><p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Update my payment card →</a></p><p>Thanks,<br>${businessName}</p>`;
    const result = await sendEmail(emailConfig, customer.email, `Action needed: update your card on file`, `Hi ${firstName}, your card${expLabel} is expiring soon. Update it here: ${portalUrl}`, html);
    if (result.success) sent.push("email");
    else logger.warn({ error: result.error, customerId: id }, "Card expiry email failed");
  }

  // SMS
  if (!customer.smsOptOut && customer.phone) {
    const smsConfig: SmsProviderConfig = {
      platform: (tenant?.phonePlatform as SmsProviderConfig["platform"]) ?? null,
      config: (tenant?.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant?.mainPhoneNumber ?? null,
    };
    const msg = `Hi ${firstName}! Your payment card${expLabel} on file with ${businessName} is expiring soon. Please update it here: ${portalUrl}`;
    const result = await sendSms(smsConfig, customer.phone, msg);
    if (result.success) sent.push("sms");
    else logger.warn({ error: result.error, customerId: id }, "Card expiry SMS failed");
  }

  // Record that a reminder was sent
  await db.update(customersTable)
    .set({ cardExpiryReminderSentAt: new Date() })
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));

  res.json({ success: true, channels: sent });
});

// Property history — properties this customer previously owned
router.get("/customers/:id/property-history", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const rows = await db
    .select({
      history: propertyOwnershipHistoryTable,
      propertyAddress: propertiesTable.address,
      propertyCity: propertiesTable.city,
      propertyState: propertiesTable.state,
      newCustomerName: customersTable.name,
    })
    .from(propertyOwnershipHistoryTable)
    .leftJoin(propertiesTable, eq(propertyOwnershipHistoryTable.propertyId, propertiesTable.id))
    .leftJoin(customersTable, eq(propertyOwnershipHistoryTable.newCustomerId, customersTable.id))
    .where(and(
      eq(propertyOwnershipHistoryTable.tenantId, tenantId),
      eq(propertyOwnershipHistoryTable.previousCustomerId, id)
    ))
    .orderBy(desc(propertyOwnershipHistoryTable.transferredAt));

  res.json(rows.map(r => ({
    id: r.history.id,
    propertyId: r.history.propertyId,
    propertyAddress: r.propertyAddress,
    propertyCity: r.propertyCity,
    propertyState: r.propertyState,
    newCustomerId: r.history.newCustomerId,
    newCustomerName: r.newCustomerName,
    notes: r.history.notes,
    transferredAt: r.history.transferredAt.toISOString(),
  })));
});

// Invoice history for customer
router.get("/customers/:id/invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const rows = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id)))
    .orderBy(desc(invoicesTable.createdAt));

  res.json(rows.map(i => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    status: i.status,
    total: i.total,
    dueDate: i.dueDate?.toISOString() ?? null,
    paidAt: i.paidAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  })));
});

// ---------------------------------------------------------------------------
// GET /customers/:id/portal-link — generate a magic-link URL for the portal
// ---------------------------------------------------------------------------
router.get("/customers/:id/portal-link", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  // The portal link opens the portal login page pre-filled with the customer's email.
  // The tenant is encoded as a query param so the portal knows which OTP to request.
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/portal`
    : "/portal";

  const url = `${baseUrl}?email=${encodeURIComponent(customer.email)}&tenant=${tenantId}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  res.json({ url, expiresAt });
});

// ---------------------------------------------------------------------------
// POST /customers/:id/resume-service — office-approved resume of a paused
// recurring series. Mirrors the pause half of PATCH /jobs/:id/pause-series.
// ---------------------------------------------------------------------------
router.post("/customers/:id/resume-service", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/office roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(jobsTable)
    .set({ isRecurrencePaused: false })
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.customerId, id),
      isNull(jobsTable.recurrenceParentId),
      eq(jobsTable.isRecurrencePaused, true),
    ));

  await db.insert(activityLogTable).values({ tenantId, userId, type: "service_resumed", message: `Recurring service resumed for ${customer.name}`, entityId: id });

  const [{ count: propCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
    .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));
  const paymentStanding = await computePaymentStanding(tenantId, id);
  res.json(formatCustomer(customer, { propertyCount: propCount, paymentStanding }));
});

// ---------------------------------------------------------------------------
// GET /customers/:id/auto-invoice-failures
// Returns any auto-invoice creation or email delivery failures for this
// customer so staff can see them and trigger a manual resend.
// ---------------------------------------------------------------------------
router.get("/customers/:id/auto-invoice-failures", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const customerId = parseInt(rawId, 10);

  // 1. Invoice creation failures — entityId = jobId
  const jobRows = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.customerId, customerId)));
  const jobIds = jobRows.map(j => j.id);

  // 2. Invoice email delivery failures — entityId = invoiceId
  const invRows = await db
    .select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, jobId: invoicesTable.jobId })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, customerId)));
  const invIds = invRows.map(i => i.id);
  const invById = new Map(invRows.map(i => [i.id, i]));

  const [creationFailures, emailFailures] = await Promise.all([
    jobIds.length > 0
      ? db
          .select()
          .from(activityLogTable)
          .where(
            and(
              eq(activityLogTable.tenantId, tenantId),
              eq(activityLogTable.type, "auto_invoice_failed"),
              inArray(activityLogTable.entityId, jobIds),
            ),
          )
          .orderBy(desc(activityLogTable.createdAt))
      : Promise.resolve([]),
    invIds.length > 0
      ? db
          .select()
          .from(activityLogTable)
          .where(
            and(
              eq(activityLogTable.tenantId, tenantId),
              eq(activityLogTable.type, "auto_invoice_email_failed"),
              inArray(activityLogTable.entityId, invIds),
            ),
          )
          .orderBy(desc(activityLogTable.createdAt))
      : Promise.resolve([]),
  ]);

  const results = [
    ...creationFailures.map(e => ({
      id: e.id,
      kind: "creation" as const,
      message: e.message,
      jobId: e.entityId,
      invoiceId: null,
      createdAt: e.createdAt.toISOString(),
    })),
    ...emailFailures.map(e => {
      const inv = e.entityId != null ? invById.get(e.entityId) : undefined;
      return {
        id: e.id,
        kind: "email" as const,
        message: e.message,
        jobId: inv?.jobId ?? null,
        invoiceId: e.entityId,
        invoiceNumber: inv?.invoiceNumber ?? null,
        createdAt: e.createdAt.toISOString(),
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(results);
});

export default router;
