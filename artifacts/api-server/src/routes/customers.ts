import { Router, type IRouter } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, activityLogTable, propertyOwnershipHistoryTable, customerOtpSessionsTable, stopServiceFlagsTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, isNull, ne } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { syncCustomerToMailchimp } from "../lib/mailchimpSync";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

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

function formatCustomer(
  c: typeof customersTable.$inferSelect,
  extras?: { propertyCount?: number; thisYearSpend?: number; lastYearSpend?: number; paymentStanding?: PaymentStanding }
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
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { q, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const baseWhere = eq(customersTable.tenantId, tenantId);
  const where = q ? and(baseWhere, ilike(customersTable.name, `%${q}%`)) : baseWhere;

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

  const propCounts = await db
    .select({ customerId: propertiesTable.customerId, count: sql<number>`count(*)::int` })
    .from(propertiesTable)
    .where(eq(propertiesTable.tenantId, tenantId))
    .groupBy(propertiesTable.customerId);

  const propMap = Object.fromEntries(propCounts.map(p => [p.customerId, p.count]));

  res.json({
    items: rows.map(c => formatCustomer(c, { propertyCount: propMap[c.id] ?? 0 })),
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
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable)
      .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.tenantId, tenantId))),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${thisYearStart}::timestamptz`)),
    db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, id), eq(invoicesTable.status, "paid"), sql`created_at >= ${lastYearStart}::timestamptz AND created_at < ${lastYearEnd}::timestamptz`)),
    computePaymentStanding(tenantId, id),
  ]);

  res.json(formatCustomer(customer, {
    propertyCount: propCount,
    thisYearSpend: thisYear?.total ?? 0,
    lastYearSpend: lastYear?.total ?? 0,
    paymentStanding,
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

export default router;
