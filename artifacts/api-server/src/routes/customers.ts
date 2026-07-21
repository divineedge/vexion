import { Router, type IRouter } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, activityLogTable, propertyOwnershipHistoryTable, customerOtpSessionsTable, stopServiceFlagsTable, communicationsLogTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, isNull, ne, inArray } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { syncCustomerToMailchimp } from "../lib/mailchimpSync";
import { isAdminRole } from "../lib/roles";
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

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const customersImportExportConfig: ImportExportEntityConfig = {
  entityKey: "customers",
  fields: [
    { key: "name", header: "Name", required: true },
    { key: "email", header: "Email", required: true, hint: "Used to match existing customers" },
    { key: "phone", header: "Phone", required: true },
    { key: "secondaryPhone", header: "Secondary Phone" },
    { key: "company", header: "Company" },
    { key: "customerType", header: "Customer Type" },
    { key: "referralSource", header: "Referral Source" },
    { key: "billingAddress", header: "Billing Address" },
    { key: "billingCity", header: "Billing City" },
    { key: "billingState", header: "Billing State" },
    { key: "billingZip", header: "Billing Zip" },
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
    { key: "billingAddress", header: "Billing Address" },
    { key: "billingCity", header: "Billing City" },
    { key: "billingState", header: "Billing State" },
    { key: "billingZip", header: "Billing Zip" },
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
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      secondaryPhone: c.secondaryPhone ?? "",
      company: c.company ?? "",
      customerType: c.customerType ?? "",
      referralSource: c.referralSource ?? "",
      billingAddress: c.billingAddress ?? "",
      billingCity: c.billingCity ?? "",
      billingState: c.billingState ?? "",
      billingZip: c.billingZip ?? "",
      notes: c.notes ?? "",
      tags: (c.tags ?? []).join("; "),
      totalSpend: c.totalSpend,
      smsOptOut: c.smsOptOut,
      emailOptOut: c.emailOptOut,
      createdAt: c.createdAt.toISOString(),
    }));
  },
  parseRow: async (_tenantId, raw) => {
    const errors: string[] = [];
    const name = requireString(raw.name, "Name", errors);
    const email = requireString(raw.email, "Email", errors);
    const phone = requireString(raw.phone, "Phone", errors);
    if (errors.length > 0 || !name || !email || !phone) return { ok: false, errors };

    const tags = raw.tags ? raw.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
    return {
      ok: true,
      values: {
        name,
        email: email.toLowerCase(),
        phone,
        secondaryPhone: optionalString(raw.secondaryPhone) ?? null,
        company: optionalString(raw.company) ?? null,
        customerType: optionalString(raw.customerType) ?? null,
        referralSource: optionalString(raw.referralSource) ?? null,
        billingAddress: optionalString(raw.billingAddress) ?? null,
        billingCity: optionalString(raw.billingCity) ?? null,
        billingState: optionalString(raw.billingState) ?? null,
        billingZip: optionalString(raw.billingZip) ?? null,
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
  extras?: { propertyCount?: number; thisYearSpend?: number; lastYearSpend?: number; paymentStanding?: PaymentStanding; lastReminderFailure?: LastReminderFailure }
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
    billingAddress: c.billingAddress ?? null,
    billingCity: c.billingCity ?? null,
    billingState: c.billingState ?? null,
    billingZip: c.billingZip ?? null,
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
    paymentStanding: extras?.paymentStanding ?? null,
    lastReminderFailure: extras?.lastReminderFailure ?? null,
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
  const { q, page = "1", limit = "20", hasReminderFailure } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const baseWhere = eq(customersTable.tenantId, tenantId);
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

  const [propCounts, failureMap] = await Promise.all([
    db
      .select({ customerId: propertiesTable.customerId, count: sql<number>`count(*)::int` })
      .from(propertiesTable)
      .where(eq(propertiesTable.tenantId, tenantId))
      .groupBy(propertiesTable.customerId),
    fetchLastReminderFailures(tenantId, rows.map(r => r.id)),
  ]);

  const propMap = Object.fromEntries(propCounts.map(p => [p.customerId, p.count]));

  res.json({
    items: rows.map(c => formatCustomer(c, {
      propertyCount: propMap[c.id] ?? 0,
      lastReminderFailure: failureMap.get(c.id) ?? null,
    })),
    total: count,
    page: pageNum,
    limit: limitNum,
  });
});

router.post("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const {
    name, email, phone, secondaryPhone, company, customerType, referralSource,
    billingAddress, billingCity, billingState, billingZip, notes, tags, customFieldValues,
    acquiredFromCampaignId,
  } = req.body;
  if (!name || !email || !phone) {
    res.status(400).json({ error: "name, email, phone are required" });
    return;
  }

  const [customer] = await db.insert(customersTable).values({
    tenantId, name, email, phone,
    secondaryPhone: secondaryPhone ?? null,
    company: company ?? null,
    customerType: customerType ?? null,
    referralSource: referralSource ?? null,
    billingAddress: billingAddress ?? null,
    billingCity: billingCity ?? null,
    billingState: billingState ?? null,
    billingZip: billingZip ?? null,
    notes: notes ?? null,
    tags: tags ?? [],
    customFieldValues: customFieldValues ?? {},
    acquiredFromCampaignId: acquiredFromCampaignId ? parseInt(acquiredFromCampaignId, 10) : null,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "customer_added", message: `New customer "${name}" added`, entityId: customer.id });
  void syncCustomerToMailchimp(tenantId, customer);

  res.status(201).json(formatCustomer(customer, { propertyCount: 0 }));
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
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
      .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId))),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${thisYearStart}::timestamptz`)),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${lastYearStart}::timestamptz AND created_at < ${lastYearEnd}::timestamptz`)),
    computePaymentStanding(tenantId, id),
    fetchLastReminderFailures(tenantId, [id]),
  ]);

  res.json(formatCustomer(customer, {
    propertyCount: propCount,
    thisYearSpend: thisYear?.total ?? 0,
    lastYearSpend: lastYear?.total ?? 0,
    paymentStanding,
    lastReminderFailure: failureMap.get(id) ?? null,
  }));
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const {
    name, email, phone, secondaryPhone, company, customerType, referralSource,
    billingAddress, billingCity, billingState, billingZip, notes, tags, customFieldValues,
    acquiredFromCampaignId, smsOptOut, emailOptOut,
  } = req.body;

  const updates: Partial<typeof customersTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phone) updates.phone = phone;
  if (secondaryPhone !== undefined) updates.secondaryPhone = secondaryPhone;
  if (company !== undefined) updates.company = company;
  if (customerType !== undefined) updates.customerType = customerType;
  if (referralSource !== undefined) updates.referralSource = referralSource;
  if (billingAddress !== undefined) updates.billingAddress = billingAddress;
  if (billingCity !== undefined) updates.billingCity = billingCity;
  if (billingState !== undefined) updates.billingState = billingState;
  if (billingZip !== undefined) updates.billingZip = billingZip;
  if (notes !== undefined) updates.notes = notes;
  if (tags !== undefined) updates.tags = tags;
  if (customFieldValues !== undefined) updates.customFieldValues = customFieldValues;
  if (acquiredFromCampaignId !== undefined) {
    updates.acquiredFromCampaignId = acquiredFromCampaignId ? parseInt(acquiredFromCampaignId, 10) : null;
  }
  if (smsOptOut !== undefined) updates.smsOptOut = smsOptOut;
  if (emailOptOut !== undefined) updates.emailOptOut = emailOptOut;
  const { autoInvoiceOnCompletion } = req.body;
  if (autoInvoiceOnCompletion !== undefined) updates.autoInvoiceOnCompletion = autoInvoiceOnCompletion;

  const [updated] = await db.update(customersTable)
    .set(updates)
    .where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (tags !== undefined) void syncCustomerToMailchimp(tenantId, updated);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
    .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId)));
  res.json(formatCustomer(updated, { propertyCount: count }));
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.tenantId, tenantId)));
  res.sendStatus(204);
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
