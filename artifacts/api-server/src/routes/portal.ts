import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, customerOtpSessionsTable, customerAlertsTable, mediaAttachmentsTable, tenantsTable, communicationsLogTable, customerPlansTable, usersTable, planCancelRequestsTable, estimatesTable, taskNotificationsTable, portalMessagesTable, internalTasksTable, chemicalApplicationsTable } from "@workspace/db";
import { eq, and, gt, desc, lte, isNotNull, ne, sql, isNull, inArray } from "drizzle-orm";
import { objectStorageService } from "./storage";
import crypto from "crypto";
import { getTenantId } from "../lib/tenantHelper";
import { sendEmail, buildOtpEmailHtml, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";
import { syncInvoicePaymentToQBO } from "../lib/quickbooksSync";
import PDFDocument from "pdfkit";
import { getStripeClient } from "../lib/stripeClient";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Upload-intent registry
// Tracks objectPaths minted by /portal/storage/uploads/request-url so the
// subsequent /portal/property/:id/media POST can verify the caller is the
// same tenant that minted the URL. Entries expire after 15 minutes (matching
// the presigned upload URL TTL) and are consumed on first use.
// ---------------------------------------------------------------------------

interface UploadIntent {
  tenantId: number;
  expiresAt: number; // ms epoch
}

const uploadIntents = new Map<string, UploadIntent>();

function registerUploadIntent(objectPath: string, tenantId: number): void {
  uploadIntents.set(objectPath, { tenantId, expiresAt: Date.now() + 15 * 60 * 1000 });
  // Opportunistically sweep expired entries to prevent unbounded growth
  const now = Date.now();
  for (const [key, intent] of uploadIntents) {
    if (intent.expiresAt <= now) uploadIntents.delete(key);
  }
}

function consumeUploadIntent(objectPath: string, tenantId: number): boolean {
  const intent = uploadIntents.get(objectPath);
  if (!intent) return false;
  if (intent.expiresAt <= Date.now()) { uploadIntents.delete(objectPath); return false; }
  if (intent.tenantId !== tenantId) return false;
  uploadIntents.delete(objectPath); // one-time use
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Middleware that reads x-portal-token and attaches customer info to req
interface PortalLocals {
  portalCustomerId: number;
  portalTenantId: number;
}

async function requirePortalAuth(
  req: Request & { portalLocals?: PortalLocals },
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.headers["x-portal-token"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    res.status(401).json({ error: "Missing portal token" });
    return;
  }
  const hashed = hashToken(token);
  const [session] = await db
    .select()
    .from(customerOtpSessionsTable)
    .where(
      and(
        eq(customerOtpSessionsTable.sessionToken, hashed),
        gt(customerOtpSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  req.portalLocals = { portalCustomerId: session.customerId, portalTenantId: session.tenantId };
  next();
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /portal/tenant-info  (public — resolves slug or tenantId to branding)
// ---------------------------------------------------------------------------
router.get("/portal/tenant-info", async (req, res): Promise<void> => {
  const slugParam = req.query.slug as string | undefined;
  const idParam = req.query.tenantId as string | undefined;

  let tenantRow: typeof tenantsTable.$inferSelect | undefined;

  if (slugParam) {
    [tenantRow] = await db.select().from(tenantsTable).where(eq(tenantsTable.slug, slugParam)).limit(1) as any;
  } else if (idParam) {
    const id = parseInt(idParam, 10);
    if (!isNaN(id)) {
      [tenantRow] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1) as any;
    }
  }

  if (!tenantRow) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  res.json({
    tenantId: tenantRow.id,
    slug: tenantRow.slug ?? null,
    name: tenantRow.name,
    logoUrl: tenantRow.logoUrl ?? null,
  });
});

// POST /portal/auth/login  (email + last 4 digits of phone on file)
// ---------------------------------------------------------------------------
router.post("/portal/auth/login", async (req, res): Promise<void> => {
  // Support slug-based tenant lookup: ?tenant=divine-edge OR x-tenant-id: 11
  let tenantId = getTenantId(req);
  const slugParam = req.query.tenant as string | undefined;
  if (slugParam && isNaN(Number(slugParam))) {
    const [slugRow] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, slugParam)).limit(1);
    if (slugRow) tenantId = slugRow.id;
  }
  const { email, last4Phone } = req.body as { email?: string; last4Phone?: string };

  if (!email || !last4Phone) {
    res.status(400).json({ error: "email and last4Phone required" });
    return;
  }

  const trimmedLast4 = last4Phone.replace(/\D/g, "").slice(-4);
  if (trimmedLast4.length !== 4) {
    res.status(400).json({ error: "last4Phone must be 4 digits" });
    return;
  }

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(
      and(
        eq(customersTable.tenantId, tenantId),
        eq(customersTable.email, email.toLowerCase().trim()),
      ),
    )
    .limit(1);

  if (!customer) {
    // Return the same generic error for both not-found and wrong phone
    // so we don't leak which emails are registered.
    res.status(401).json({ error: "Email or phone number does not match our records." });
    return;
  }

  // Strip non-digits from the stored phone and check the last 4
  const storedDigits = (customer.phone ?? "").replace(/\D/g, "");
  if (storedDigits.length < 4 || !storedDigits.endsWith(trimmedLast4)) {
    res.status(401).json({ error: "Email or phone number does not match our records." });
    return;
  }

  // Issue a session token valid for 30 days (reuse the OTP sessions table)
  const sessionToken = generateToken();
  const sessionHash = hashToken(sessionToken);
  const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Clear any pre-existing sessions for this customer
  await db
    .delete(customerOtpSessionsTable)
    .where(
      and(
        eq(customerOtpSessionsTable.email, email.toLowerCase().trim()),
        eq(customerOtpSessionsTable.tenantId, tenantId),
      ),
    );

  await db.insert(customerOtpSessionsTable).values({
    tenantId,
    customerId: customer.id,
    email: email.toLowerCase().trim(),
    otpHash: "",           // no OTP used in this flow
    sessionToken: sessionHash,
    expiresAt: sessionExpiry,
  });

  res.json({
    token: sessionToken,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /portal/auth/request-otp
// ---------------------------------------------------------------------------
router.post("/portal/auth/request-otp", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.tenantId, tenantId), eq(customersTable.email, email.toLowerCase().trim())))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  const otp = generateOtp();
  const otpHash = hashToken(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Invalidate any existing un-verified sessions for this email
  await db
    .delete(customerOtpSessionsTable)
    .where(
      and(
        eq(customerOtpSessionsTable.email, email.toLowerCase().trim()),
        eq(customerOtpSessionsTable.tenantId, tenantId),
      ),
    );

  await db.insert(customerOtpSessionsTable).values({
    tenantId,
    customerId: customer.id,
    email: email.toLowerCase().trim(),
    otpHash,
    expiresAt,
  });

  // Fetch tenant for email provider config and branding
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const companyName = tenant?.name ?? "Your Service Provider";

  const emailProviderConfig: EmailProviderConfig = {
    provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
    config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
    fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
  };

  const subject = `Your ${companyName} login code`;
  const body = [
    `Hi ${customer.name ?? "there"},`,
    "",
    `Your one-time login code for the ${companyName} client portal is:`,
    "",
    `  ${otp}`,
    "",
    "This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.",
    "",
    `Thank you,`,
    companyName,
  ].join("\n");

  const htmlBody = buildOtpEmailHtml({
    customerName: customer.name ?? null,
    otp,
    companyName,
  });

  const emailResult = await sendEmail(emailProviderConfig, email.toLowerCase().trim(), subject, body, htmlBody);

  if (!emailResult.success) {
    logger.error({ to: email, error: emailResult.error }, "Failed to send portal OTP email");
    // Log the failed attempt
    await db.insert(communicationsLogTable).values({
      tenantId,
      customerId: customer.id,
      direction: "outbound",
      channel: "email",
      fromAddress: emailProviderConfig.fromAddress ?? null,
      toAddress: email.toLowerCase().trim(),
      subject,
      body,
      status: "failed",
      messageType: "portal_otp",
    }).catch(() => { /* best-effort logging */ });
    res.status(500).json({ error: "Failed to send login code. Please try again or contact support." });
    return;
  }

  // Log the sent OTP email in the communications log
  await db.insert(communicationsLogTable).values({
    tenantId,
    customerId: customer.id,
    direction: "outbound",
    channel: "email",
    fromAddress: emailProviderConfig.fromAddress ?? null,
    toAddress: email.toLowerCase().trim(),
    subject,
    body,
    status: "sent",
    externalId: emailResult.externalId ?? null,
    messageType: "portal_otp",
  }).catch((err) => {
    logger.warn({ err }, "Failed to write portal OTP to communications log");
  });

  // Return previewOtp only in development so engineers can test without a real email service.
  // Return emailDelivered: false when no real email provider is configured so the frontend
  // can show a meaningful warning instead of "Check your email" (which would never arrive).
  const isDev = process.env.NODE_ENV !== "production";
  const emailDelivered = !emailResult.devOnly;
  res.json({
    message: "OTP sent to your email",
    previewOtp: isDev ? otp : undefined,
    emailDelivered,
  });
});

// ---------------------------------------------------------------------------
// POST /portal/auth/verify-otp
// ---------------------------------------------------------------------------
router.post("/portal/auth/verify-otp", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { email, otp } = req.body as { email?: string; otp?: string };
  if (!email || !otp) {
    res.status(400).json({ error: "email and otp required" });
    return;
  }

  const otpHash = hashToken(otp);
  const now = new Date();

  const [session] = await db
    .select()
    .from(customerOtpSessionsTable)
    .where(
      and(
        eq(customerOtpSessionsTable.email, email.toLowerCase().trim()),
        eq(customerOtpSessionsTable.tenantId, tenantId),
        eq(customerOtpSessionsTable.otpHash, otpHash),
        gt(customerOtpSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  // Issue a session token valid for 30 days
  const sessionToken = generateToken();
  const sessionHash = hashToken(sessionToken);
  const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db
    .update(customerOtpSessionsTable)
    .set({ sessionToken: sessionHash, otpHash: "", expiresAt: sessionExpiry })
    .where(eq(customerOtpSessionsTable.id, session.id));

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, session.customerId))
    .limit(1);

  if (!customer) {
    res.status(500).json({ error: "Customer not found" });
    return;
  }

  res.json({
    token: sessionToken,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company ?? null,
      profilePhotoUrl: null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /portal/me
// ---------------------------------------------------------------------------
router.get("/portal/me", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId } = req.portalLocals as PortalLocals;
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, portalCustomerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.json({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    company: customer.company ?? null,
    profilePhotoUrl: null,
  });
});

// ---------------------------------------------------------------------------
// PATCH /portal/me  — let customers update their own contact info
// ---------------------------------------------------------------------------
router.patch("/portal/me", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const { name, phone } = req.body as { name?: string; phone?: string };

  const updates: Record<string, string> = {};
  if (name !== undefined) updates.name = name.trim();
  if (phone !== undefined) updates.phone = phone.trim();

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(customersTable)
    .set(updates)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone,
    company: updated.company ?? null,
    profilePhotoUrl: null,
  });
});

// ---------------------------------------------------------------------------
// GET  /portal/me/payment-method  — customer's saved card
// POST /portal/me/setup-intent    — start Stripe card setup
// POST /portal/me/attach-payment-method — save confirmed card
// DELETE /portal/me/payment-method — remove saved card
// ---------------------------------------------------------------------------

router.get("/portal/me/payment-method", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)));
  if (!customer?.stripeDefaultPaymentMethodId) { res.json({ paymentMethod: null }); return; }

  const stripe = getStripeClient();
  if (!stripe) { res.json({ paymentMethod: null }); return; }

  try {
    const pm = await stripe.paymentMethods.retrieve(customer.stripeDefaultPaymentMethodId);
    res.json({ paymentMethod: pm.card ? {
      label: `${pm.card.brand} ···· ${pm.card.last4}`,
      last4: pm.card.last4,
      brand: pm.card.brand,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    } : null });
  } catch {
    res.json({ paymentMethod: null });
  }
});

router.post("/portal/me/setup-intent", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const stripe = getStripeClient();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const { ensureStripeCustomer, getStripePublishableKey } = await import("../lib/stripe");
  const stripeCustomerId = await ensureStripeCustomer(portalCustomerId, customer.name, customer.email, customer.stripeCustomerId);

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) { res.status(503).json({ error: "Stripe publishable key not configured" }); return; }

  res.json({ clientSecret: setupIntent.client_secret, publishableKey });
});

router.post("/portal/me/attach-payment-method", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const { paymentMethodId } = req.body as { paymentMethodId?: string };
  if (!paymentMethodId) { res.status(400).json({ error: "paymentMethodId required" }); return; }

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }

  const stripe = getStripeClient();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const { ensureStripeCustomer } = await import("../lib/stripe");
  const stripeCustomerId = await ensureStripeCustomer(portalCustomerId, customer.name, customer.email, customer.stripeCustomerId);

  // Retrieve the PM to validate expiry BEFORE attaching
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (!pm.card) { res.status(400).json({ error: "Only card payment methods are supported" }); return; }

  const now = new Date();
  const threeMonthsLater = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  const cardExpiry = new Date(pm.card.exp_year, pm.card.exp_month, 0); // last day of expiry month
  if (cardExpiry < threeMonthsLater) {
    const exp = `${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}`;
    res.status(400).json({ error: `This card expires ${exp}. Please use a card with at least 3 months remaining.` });
    return;
  }

  await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  await db.update(customersTable)
    .set({
      stripeDefaultPaymentMethodId: paymentMethodId,
      cardExpiresAt: cardExpiry.toISOString().split("T")[0],
      cardExpiryReminderSentAt: null,
    })
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)));

  res.json({ success: true });
});

router.delete("/portal/me/payment-method", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  await db.update(customersTable)
    .set({ stripeDefaultPaymentMethodId: null, cardExpiresAt: null, cardExpiryReminderSentAt: null })
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.tenantId, portalTenantId)));
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// GET /portal/summary
// ---------------------------------------------------------------------------
router.get("/portal/summary", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const now = new Date();

  const [upcomingJobs, recentInvoices, pendingAlerts, openRequests, pendingEstimates, tenant] = await Promise.all([
    db
      .select({ job: jobsTable, propertyAddress: propertiesTable.address, assignedToName: usersTable.name })
      .from(jobsTable)
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
      .where(
        and(
          eq(jobsTable.customerId, portalCustomerId),
          eq(jobsTable.tenantId, portalTenantId),
        ),
      )
      .orderBy(jobsTable.scheduledAt)
      .limit(5),
    db
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.customerId, portalCustomerId),
          eq(invoicesTable.tenantId, portalTenantId),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .limit(5),
    db
      .select()
      .from(customerAlertsTable)
      .where(
        and(
          eq(customerAlertsTable.customerId, portalCustomerId),
          eq(customerAlertsTable.tenantId, portalTenantId),
          eq(customerAlertsTable.status, "pending"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.customerId, portalCustomerId),
          eq(jobsTable.tenantId, portalTenantId),
          eq(jobsTable.source, "portal"),
          ne(jobsTable.status, "completed"),
          ne(jobsTable.status, "cancelled"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(estimatesTable)
      .where(
        and(
          eq(estimatesTable.customerId, portalCustomerId),
          eq(estimatesTable.tenantId, portalTenantId),
          eq(estimatesTable.status, "sent"),
        ),
      ),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, portalTenantId)).limit(1),
  ]);

  const tenantRecord = tenant[0];
  res.json({
    upcomingJobs: upcomingJobs.map(r => formatPortalJob(r.job, r.propertyAddress, r.assignedToName)),
    recentInvoices: recentInvoices.map(formatPortalInvoice),
    unreadAlertCount: pendingAlerts.length,
    openRequestCount: openRequests[0]?.count ?? 0,
    pendingEstimateCount: pendingEstimates[0]?.count ?? 0,
    tenantPhone: tenantRecord?.businessPhone ?? null,
    tenantEmail: tenantRecord?.businessEmail ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /portal/jobs/:id  — full job detail for a single job
// ---------------------------------------------------------------------------
router.get("/portal/jobs/:id", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const jobId = parseInt(req.params.id, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [row] = await db
    .select({ job: jobsTable, propertyAddress: propertiesTable.address, assignedToName: usersTable.name })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(
      eq(jobsTable.id, jobId),
      eq(jobsTable.customerId, portalCustomerId),
      eq(jobsTable.tenantId, portalTenantId),
    ))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Job not found" }); return; }

  const chemApps = await db
    .select({
      id: chemicalApplicationsTable.id,
      productName: chemicalApplicationsTable.productName,
      mixtureName: chemicalApplicationsTable.mixtureName,
      volumeApplied: chemicalApplicationsTable.volumeApplied,
      volumeUnit: chemicalApplicationsTable.volumeUnit,
      treatedArea: chemicalApplicationsTable.treatedArea,
      areaUnit: chemicalApplicationsTable.areaUnit,
      treatedZoneName: chemicalApplicationsTable.treatedZoneName,
      appliedAt: chemicalApplicationsTable.appliedAt,
      rainfastUntil: (chemicalApplicationsTable as any).rainfastUntil,
      reentryUntil: (chemicalApplicationsTable as any).reentryUntil,
    })
    .from(chemicalApplicationsTable)
    .where(and(
      eq(chemicalApplicationsTable.jobId, jobId),
      eq(chemicalApplicationsTable.tenantId, portalTenantId),
    ))
    .orderBy(chemicalApplicationsTable.appliedAt);

  // Strip pricing from job parts — customers see name/quantity/unit only
  const rawParts = (row.job.jobParts as any[]) ?? [];
  const parts = rawParts.map((p: any) => ({
    name: p.name ?? null,
    quantity: p.quantity ?? null,
    unit: p.unit ?? null,
  }));

  res.json({
    ...formatPortalJob(row.job, row.propertyAddress, row.assignedToName),
    clockInAt: (row.job as any).clockInAt ? new Date((row.job as any).clockInAt).toISOString() : null,
    parts,
    chemicalApplications: chemApps.map(c => ({
      id: c.id,
      productName: c.productName ?? null,
      mixtureName: c.mixtureName ?? null,
      volumeApplied: c.volumeApplied,
      volumeUnit: c.volumeUnit,
      treatedArea: c.treatedArea ?? null,
      areaUnit: c.areaUnit ?? null,
      treatedZoneName: c.treatedZoneName ?? null,
      appliedAt: c.appliedAt.toISOString(),
      rainfastUntil: c.rainfastUntil ? new Date(c.rainfastUntil).toISOString() : null,
      reentryUntil: c.reentryUntil ? new Date(c.reentryUntil).toISOString() : null,
    })),
  });
});

// GET /portal/active-timers — returns chemical application records with active rainfast/re-entry windows
// ---------------------------------------------------------------------------
router.get("/portal/active-timers", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  // Fetch all applications for this customer's jobs that have at least one timer set
  const rows = await db
    .select({
      id: chemicalApplicationsTable.id,
      jobId: chemicalApplicationsTable.jobId,
      productName: chemicalApplicationsTable.productName,
      mixtureName: chemicalApplicationsTable.mixtureName,
      appliedAt: chemicalApplicationsTable.appliedAt,
      rainfastUntil: (chemicalApplicationsTable as any).rainfastUntil,
      reentryUntil: (chemicalApplicationsTable as any).reentryUntil,
      propertyAddress: propertiesTable.address,
      jobTitle: jobsTable.title,
    })
    .from(chemicalApplicationsTable)
    .innerJoin(jobsTable, eq(chemicalApplicationsTable.jobId, jobsTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(and(
      eq(jobsTable.customerId, portalCustomerId),
      eq(jobsTable.tenantId, portalTenantId),
      sql`(${(chemicalApplicationsTable as any).rainfastUntil} > now() OR ${(chemicalApplicationsTable as any).reentryUntil} > now())`,
    ))
    .orderBy(desc(chemicalApplicationsTable.appliedAt));

  res.json(rows.map(r => ({
    id: r.id,
    jobId: r.jobId,
    jobTitle: r.jobTitle ?? null,
    productName: r.productName ?? null,
    mixtureName: r.mixtureName ?? null,
    appliedAt: r.appliedAt.toISOString(),
    rainfastUntil: r.rainfastUntil ? new Date(r.rainfastUntil).toISOString() : null,
    reentryUntil: r.reentryUntil ? new Date(r.reentryUntil).toISOString() : null,
    propertyAddress: r.propertyAddress ?? null,
  })));
});

// GET /portal/jobs
// ---------------------------------------------------------------------------
router.get("/portal/jobs", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select({ job: jobsTable, propertyAddress: propertiesTable.address, assignedToName: usersTable.name })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(
      and(
        eq(jobsTable.customerId, portalCustomerId),
        eq(jobsTable.tenantId, portalTenantId),
      ),
    )
    .orderBy(desc(jobsTable.scheduledAt));

  res.json(rows.map(r => formatPortalJob(r.job, r.propertyAddress, r.assignedToName)));
});

// ---------------------------------------------------------------------------
// GET /portal/invoices
// ---------------------------------------------------------------------------
router.get("/portal/invoices", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.customerId, portalCustomerId),
        eq(invoicesTable.tenantId, portalTenantId),
      ),
    )
    .orderBy(desc(invoicesTable.createdAt));

  res.json(rows.map(formatPortalInvoice));
});

// ---------------------------------------------------------------------------
// GET /portal/invoices/:id
// ---------------------------------------------------------------------------
router.get("/portal/invoices/:id", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const invoiceId = parseInt(req.params.id, 10);

  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.id, invoiceId),
        eq(invoicesTable.customerId, portalCustomerId),
        eq(invoicesTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(formatPortalInvoice(invoice));
});

// ---------------------------------------------------------------------------
// GET /portal/invoices/:id/pdf
// ---------------------------------------------------------------------------
router.get("/portal/invoices/:id/pdf", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const invoiceId = parseInt(req.params.id, 10);

  const [[invoice], [tenant], [customer]] = await Promise.all([
    db
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.id, invoiceId),
          eq(invoicesTable.customerId, portalCustomerId),
          eq(invoicesTable.tenantId, portalTenantId),
        ),
      )
      .limit(1),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, portalTenantId)).limit(1),
    db.select().from(customersTable).where(eq(customersTable.id, portalCustomerId)).limit(1),
  ]);

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const companyName = tenant?.name ?? "Your Service Provider";
  const safeInvoiceNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="invoice-${safeInvoiceNumber}.pdf"`,
  );

  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  doc.pipe(res);

  // ── Header: company name & branding ──────────────────────────────────────
  const brandColor = "#16a34a"; // green-600
  doc
    .fontSize(22)
    .fillColor(brandColor)
    .font("Helvetica-Bold")
    .text(companyName, 50, 50, { align: "left" });

  // Company contact info (right-aligned)
  const contactLines: string[] = [];
  if (tenant?.businessAddress) contactLines.push(tenant.businessAddress);
  if (tenant?.businessPhone) contactLines.push(tenant.businessPhone);
  if (tenant?.businessEmail) contactLines.push(tenant.businessEmail);
  if (contactLines.length > 0) {
    doc
      .fontSize(9)
      .fillColor("#555555")
      .font("Helvetica")
      .text(contactLines.join("\n"), 50, 55, { align: "right" });
  }

  // ── Invoice title bar ─────────────────────────────────────────────────────
  const titleY = 110;
  doc.rect(50, titleY, 512, 30).fill(brandColor);
  doc
    .fontSize(14)
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .text("INVOICE", 60, titleY + 8, { align: "left", width: 496 });

  // Invoice number (right side of title bar)
  doc.text(`#${invoice.invoiceNumber}`, 60, titleY + 8, { align: "right", width: 496 });

  // ── Bill to / Invoice details ─────────────────────────────────────────────
  const detailsY = 155;
  doc
    .fontSize(9)
    .fillColor("#888888")
    .font("Helvetica-Bold")
    .text("BILL TO", 50, detailsY);

  doc
    .fontSize(10)
    .fillColor("#222222")
    .font("Helvetica")
    .text(customer?.name ?? "Customer", 50, detailsY + 14);

  if (customer?.email) {
    doc.fontSize(9).fillColor("#555555").text(customer.email, 50, detailsY + 28);
  }

  // Right column: dates & status
  const metaX = 380;
  const metaLabelColor = "#888888";
  const metaValueColor = "#222222";

  const formatDate = (d: Date | null | undefined): string => {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const metaRows: Array<[string, string]> = [
    ["Issue Date", formatDate(invoice.createdAt)],
    ["Due Date", formatDate(invoice.dueDate ?? null)],
    ["Status", (invoice.status ?? "draft").toUpperCase()],
  ];
  if (invoice.paidAt) {
    metaRows.push(["Paid On", formatDate(invoice.paidAt)]);
  }

  let metaY = detailsY;
  for (const [label, value] of metaRows) {
    doc.fontSize(9).fillColor(metaLabelColor).font("Helvetica-Bold").text(label, metaX, metaY, { width: 80 });
    doc.fontSize(9).fillColor(metaValueColor).font("Helvetica").text(value, metaX + 90, metaY, { width: 132 });
    metaY += 14;
  }

  // ── Line items table ──────────────────────────────────────────────────────
  const tableTop = detailsY + 85;
  const colDesc = 50;
  const colQty = 340;
  const colUnit = 390;
  const colTotal = 460;
  const tableWidth = 512;

  // Table header
  doc.rect(50, tableTop, tableWidth, 22).fill("#f3f4f6");
  doc.fontSize(9).fillColor("#444444").font("Helvetica-Bold");
  doc.text("Description", colDesc + 4, tableTop + 6, { width: 280 });
  doc.text("Qty", colQty + 4, tableTop + 6, { width: 44, align: "right" });
  doc.text("Unit Price", colUnit + 4, tableTop + 6, { width: 60, align: "right" });
  doc.text("Total", colTotal + 4, tableTop + 6, { width: 100, align: "right" });

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  type LineItem = { description?: string; quantity?: number; unitPrice?: number; total?: number };
  const lineItems = (invoice.lineItems as LineItem[]) ?? [];

  let rowY = tableTop + 22;
  let rowIndex = 0;
  for (const item of lineItems) {
    const rowHeight = 22;
    if (rowIndex % 2 === 1) {
      doc.rect(50, rowY, tableWidth, rowHeight).fill("#f9fafb");
    }
    doc.fontSize(9).fillColor("#222222").font("Helvetica");
    doc.text(item.description ?? "", colDesc + 4, rowY + 6, { width: 280 });
    doc.text(String(item.quantity ?? 1), colQty + 4, rowY + 6, { width: 44, align: "right" });
    doc.text(formatCurrency(item.unitPrice ?? 0), colUnit + 4, rowY + 6, { width: 60, align: "right" });
    doc.text(formatCurrency(item.total ?? 0), colTotal + 4, rowY + 6, { width: 100, align: "right" });
    rowY += rowHeight;
    rowIndex++;
  }

  if (lineItems.length === 0) {
    doc.fontSize(9).fillColor("#888888").font("Helvetica")
      .text("No line items", colDesc + 4, rowY + 6, { width: 500 });
    rowY += 22;
  }

  // Bottom border of table
  doc.moveTo(50, rowY).lineTo(562, rowY).strokeColor("#e5e7eb").lineWidth(1).stroke();

  // ── Totals ────────────────────────────────────────────────────────────────
  rowY += 12;
  const totalsX = 380;

  const subtotal = invoice.subtotal ?? 0;
  const tax = invoice.tax ?? 0;
  const total = invoice.total ?? 0;

  doc.fontSize(9).fillColor("#555555").font("Helvetica");
  doc.text("Subtotal", totalsX, rowY, { width: 80 });
  doc.text(formatCurrency(subtotal), totalsX + 90, rowY, { width: 92, align: "right" });
  rowY += 16;

  if (tax !== 0) {
    doc.text("Tax", totalsX, rowY, { width: 80 });
    doc.text(formatCurrency(tax), totalsX + 90, rowY, { width: 92, align: "right" });
    rowY += 16;
  }

  // Total row
  doc.rect(totalsX - 4, rowY - 4, 192, 24).fill(brandColor);
  doc.fontSize(11).fillColor("#ffffff").font("Helvetica-Bold");
  doc.text("TOTAL", totalsX, rowY + 2, { width: 80 });
  doc.text(formatCurrency(total), totalsX + 90, rowY + 2, { width: 92, align: "right" });
  rowY += 32;

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (invoice.notes) {
    rowY += 12;
    doc.fontSize(9).fillColor("#888888").font("Helvetica-Bold").text("Notes", 50, rowY);
    rowY += 14;
    doc.fontSize(9).fillColor("#444444").font("Helvetica").text(invoice.notes, 50, rowY, { width: 512 });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  doc
    .fontSize(8)
    .fillColor("#aaaaaa")
    .font("Helvetica")
    .text(`Thank you for your business — ${companyName}`, 50, 730, {
      align: "center",
      width: 512,
    });

  doc.end();
});

// ---------------------------------------------------------------------------
// GET /portal/properties
// ---------------------------------------------------------------------------
router.get("/portal/properties", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select()
    .from(propertiesTable)
    .where(
      and(
        eq(propertiesTable.customerId, portalCustomerId),
        eq(propertiesTable.tenantId, portalTenantId),
      ),
    )
    .orderBy(propertiesTable.address);

  res.json(
    rows.map(p => ({
      id: p.id,
      address: p.address,
      city: p.city ?? null,
      state: p.state ?? null,
      zip: p.zip ?? null,
      type: p.type ?? null,
      notes: p.notes ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      measurementPolygons: (p.measurementPolygons as unknown[]) ?? [],
      serviceableAreaSqft: p.serviceableAreaSqft ?? null,
      sizeUnit: p.sizeUnit ?? "sqft",
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /portal/alerts
// ---------------------------------------------------------------------------
router.get("/portal/alerts", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select({ alert: customerAlertsTable, jobTitle: jobsTable.title })
    .from(customerAlertsTable)
    .leftJoin(jobsTable, eq(customerAlertsTable.jobId, jobsTable.id))
    .where(
      and(
        eq(customerAlertsTable.customerId, portalCustomerId),
        eq(customerAlertsTable.tenantId, portalTenantId),
      ),
    )
    .orderBy(desc(customerAlertsTable.createdAt));

  res.json(rows.map(r => formatPortalAlert(r.alert, r.jobTitle)));
});

// ---------------------------------------------------------------------------
// PATCH /portal/alerts/:id/respond
// ---------------------------------------------------------------------------
router.patch("/portal/alerts/:id/respond", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const alertId = parseInt(req.params.id, 10);
  const { action, customerResponse } = req.body as { action?: string; customerResponse?: string };

  if (!action || !["accept", "decline"].includes(action)) {
    res.status(400).json({ error: "action must be accept or decline" });
    return;
  }

  const [existing] = await db
    .select()
    .from(customerAlertsTable)
    .where(
      and(
        eq(customerAlertsTable.id, alertId),
        eq(customerAlertsTable.customerId, portalCustomerId),
        eq(customerAlertsTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }

  const [updated] = await db
    .update(customerAlertsTable)
    .set({
      status: action === "accept" ? "accepted" : "declined",
      customerResponse: customerResponse ?? null,
    })
    .where(eq(customerAlertsTable.id, alertId))
    .returning();

  const [job] = await db.select({ title: jobsTable.title }).from(jobsTable).where(eq(jobsTable.id, updated.jobId)).limit(1);

  // Notify the company by email — fire-and-forget, never blocks the response
  (async () => {
    try {
      const [tenantRow, customerRow] = await Promise.all([
        db.select().from(tenantsTable).where(eq(tenantsTable.id, portalTenantId)).limit(1),
        db.select({ name: customersTable.name, email: customersTable.email }).from(customersTable).where(eq(customersTable.id, portalCustomerId)).limit(1),
      ]);

      const tenant = tenantRow[0];
      const notifyTo = tenant?.businessEmail ?? null;
      if (!notifyTo) {
        logger.info({ tenantId: portalTenantId, alertId }, "No businessEmail configured — skipping alert-response notification");
        return;
      }

      const emailProviderConfig: EmailProviderConfig = {
        provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
        config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
        fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
      };

      const companyName = tenant?.name ?? "Your Company";
      const customerName = customerRow[0]?.name ?? "A customer";
      const customerEmail = customerRow[0]?.email ?? null;
      const jobTitle = job?.title ?? `Alert #${alertId}`;
      const responseLabel = action === "accept" ? "Accepted" : "Declined";

      const subject = `Customer ${responseLabel} an Alert — ${jobTitle}`;
      const body = [
        `A customer has responded to a job alert.`,
        "",
        `Customer:  ${customerName}${customerEmail ? ` <${customerEmail}>` : ""}`,
        `Job:       ${jobTitle}`,
        `Response:  ${responseLabel}`,
        customerResponse ? `Comments:  ${customerResponse}` : null,
        "",
        `— ${companyName} Portal`,
      ].filter(l => l !== null).join("\n");

      const result = await sendEmail(emailProviderConfig, notifyTo, subject, body);
      if (!result.success) {
        logger.warn({ tenantId: portalTenantId, alertId, error: result.error }, "Failed to send alert-response notification email");
      } else {
        logger.info({ tenantId: portalTenantId, alertId, to: notifyTo }, "Alert-response notification email sent");
      }
    } catch (err) {
      logger.error({ err }, "Unexpected error sending alert-response notification email");
    }
  })();

  res.json(formatPortalAlert(updated, job?.title ?? null));
});

// ---------------------------------------------------------------------------
// GET /portal/service-requests
// ---------------------------------------------------------------------------
router.get("/portal/service-requests", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select({ job: jobsTable, propertyAddress: propertiesTable.address })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(
      and(
        eq(jobsTable.customerId, portalCustomerId),
        eq(jobsTable.tenantId, portalTenantId),
        eq(jobsTable.source, "portal"),
      ),
    )
    .orderBy(desc(jobsTable.createdAt));

  res.json(rows.map(r => formatPortalJob(r.job, r.propertyAddress)));
});

// ---------------------------------------------------------------------------
// POST /portal/service-requests
// ---------------------------------------------------------------------------
router.post("/portal/service-requests", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const { propertyId, description, preferredDateStart, priority } = req.body as {
    propertyId?: number;
    description?: string;
    preferredDateStart?: string;
    priority?: string;
  };

  if (!propertyId || !description) {
    res.status(400).json({ error: "propertyId and description required" });
    return;
  }

  // Verify the property belongs to this portal customer and tenant (prevents IDOR)
  const [ownedProperty] = await db
    .select()
    .from(propertiesTable)
    .where(
      and(
        eq(propertiesTable.id, propertyId),
        eq(propertiesTable.customerId, portalCustomerId),
        eq(propertiesTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!ownedProperty) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const validPriorities = ["low", "normal", "high", "urgent"];
  const resolvedPriority = priority && validPriorities.includes(priority) ? priority : "normal";
  // When no preferred date is given, use a far-future placeholder so the NOT NULL
  // constraint is satisfied. The job stays in pending status and won't appear on
  // the scheduled calendar; staff will set the real date when they assign it.
  const scheduledAt = preferredDateStart
    ? new Date(preferredDateStart)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const [job] = await db
    .insert(jobsTable)
    .values({
      tenantId: portalTenantId,
      title: "Service Request",
      description: description ?? null,
      status: "pending",
      priority: resolvedPriority,
      customerId: portalCustomerId,
      propertyId,
      scheduledAt,
      totalAmount: 0,
      source: "portal",
    })
    .returning();

  // Fetch property address, tenant config, customer name, and staff users in parallel
  const [propRow, tenantRow, customerRow, staffUsers] = await Promise.all([
    db.select({ address: propertiesTable.address }).from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, portalTenantId)).limit(1),
    db.select({ name: customersTable.name, email: customersTable.email }).from(customersTable).where(eq(customersTable.id, portalCustomerId)).limit(1),
    db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.tenantId, portalTenantId), ne(usersTable.role, "technician"))),
  ]);

  const propertyAddress = propRow[0]?.address ?? null;
  const customerName = customerRow[0]?.name ?? "A customer";

  // Fire-and-forget in-app notifications to all non-technician staff
  if (staffUsers.length > 0) {
    db.insert(taskNotificationsTable).values(
      staffUsers.map(u => ({
        tenantId: portalTenantId,
        recipientUserId: u.id,
        taskId: null,
        type: "portal_request",
        message: `${customerName} submitted a service request${propertyAddress ? ` for ${propertyAddress}` : ""} (Job #${job.id})`,
        linkPath: `/schedule?jobId=${job.id}`,
        isRead: false,
      }))
    ).catch(err => logger.error({ err }, "Failed to insert portal request notifications"));
  }

  // Create an internal task for admin_office so the request shows in the task list (fire-and-forget)
  if (staffUsers.length > 0) {
    db.insert(internalTasksTable).values({
      tenantId: portalTenantId,
      title: `Portal Request — ${customerName}`,
      description: `${propertyAddress ? `Property: ${propertyAddress}\n` : ""}${description}`,
      taskType: "custom",
      createdById: staffUsers[0].id,
      assignedToRole: "admin_office",
      priority: resolvedPriority,
      status: "open",
      contextType: "job",
      contextId: job.id,
    }).catch(err => logger.error({ err }, "Failed to create internal task for portal request"));
  }

  // Send notification email to the tenant — fire-and-forget, never blocks the response
  (async () => {
    try {
      const tenant = tenantRow[0];
      const notifyTo = tenant?.businessEmail ?? null;
      if (!notifyTo) {
        logger.info({ tenantId: portalTenantId, jobId: job.id }, "No businessEmail configured — skipping service-request notification");
        return;
      }

      const emailProviderConfig: EmailProviderConfig = {
        provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
        config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
        fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
      };

      const companyName = tenant?.name ?? "Your Company";
      const customerEmail = customerRow[0]?.email ?? null;
      const preferredDate = preferredDateStart
        ? new Date(preferredDateStart).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : "No preference specified";

      const subject = `New Service Request — ${customerName}`;
      const body = [
        `A new service request has been submitted through the customer portal.`,
        "",
        `Customer:         ${customerName}${customerEmail ? ` <${customerEmail}>` : ""}`,
        `Property Address: ${propertyAddress ?? "Not specified"}`,
        `Preferred Date:   ${preferredDate}`,
        "",
        "Request Details:",
        description,
        "",
        `This request has been saved as Job #${job.id} in ${companyName}.`,
        "",
        `— ${companyName} Portal`,
      ].join("\n");

      const result = await sendEmail(emailProviderConfig, notifyTo, subject, body);
      if (!result.success) {
        logger.warn({ tenantId: portalTenantId, jobId: job.id, error: result.error }, "Failed to send service-request notification email");
      } else {
        logger.info({ tenantId: portalTenantId, jobId: job.id, to: notifyTo }, "Service-request notification email sent");
      }
    } catch (err) {
      logger.error({ err }, "Unexpected error sending service-request notification email");
    }
  })();

  res.status(201).json(formatPortalJob(job, propertyAddress));
});

// ---------------------------------------------------------------------------
// POST /portal/storage/uploads/request-url
// ---------------------------------------------------------------------------
router.post("/portal/storage/uploads/request-url", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalTenantId } = req.portalLocals as PortalLocals;
  const { name, size, contentType } = req.body as { name?: string; size?: number; contentType?: string };

  if (!name || !size || !contentType) {
    res.status(400).json({ error: "name, size, and contentType are required" });
    return;
  }

  if (!contentType.startsWith("image/")) {
    res.status(400).json({ error: "Only image uploads are allowed from the portal" });
    return;
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  if (size > MAX_SIZE) {
    res.status(400).json({ error: "File size must not exceed 10 MB" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Record the intent BEFORE returning the URL so the subsequent media POST
    // can verify this tenant is the one that minted the path.
    registerUploadIntent(objectPath, portalTenantId);

    // Stamp tenant ownership at mint time (best-effort — object doesn't exist yet)
    try {
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: String(portalTenantId),
        visibility: "private",
      });
    } catch {
      // Non-fatal: ObjectNotFoundError is expected before the PUT completes
    }

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (err) {
    logger.error({ err }, "Error generating portal upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ---------------------------------------------------------------------------
// POST /portal/property/:id/media
// ---------------------------------------------------------------------------
router.post("/portal/property/:id/media", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const propertyId = Number(req.params.id);

  // Verify property belongs to this customer
  const [property] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(
      eq(propertiesTable.id, propertyId),
      eq(propertiesTable.tenantId, portalTenantId),
      eq(propertiesTable.customerId, portalCustomerId),
    ))
    .limit(1);

  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string;
    sizeBytes?: number; caption?: string;
  };

  if (!fileKey || !fileUrl || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }

  if (!mimeType.startsWith("image/")) {
    res.status(400).json({ error: "Only image uploads are allowed from the portal" });
    return;
  }

  const MAX_SIZE = 10 * 1024 * 1024;
  if (Number(sizeBytes) > MAX_SIZE) {
    res.status(400).json({ error: "File size must not exceed 10 MB" });
    return;
  }

  // Normalize the fileKey (client may send the raw GCS URL or the /objects/... path)
  const normalizedFileKey = objectStorageService.normalizeObjectEntityPath(fileKey);

  // Verify this objectPath was minted by this tenant's portal upload session.
  // consumeUploadIntent is one-time-use and checks tenantId, preventing cross-tenant
  // object registration and replay attacks.
  if (!consumeUploadIntent(normalizedFileKey, portalTenantId)) {
    logger.warn({ portalTenantId, fileKey: normalizedFileKey }, "Portal media POST: fileKey not found in upload intents — possible cross-tenant or stale upload attempt");
    res.status(403).json({ error: "Upload not authorized. Please retry the upload." });
    return;
  }

  const [attachment] = await db
    .insert(mediaAttachmentsTable)
    .values({
      tenantId: portalTenantId,
      entityType: "property",
      entityId: propertyId,
      fileKey: normalizedFileKey,
      fileUrl: normalizedFileKey,
      mimeType,
      sizeBytes: Number(sizeBytes),
      caption: caption ?? null,
      isCover: false,
      createdBy: null,
      source: "customer",
    })
    .returning();

  res.status(201).json(attachment);
});

// ---------------------------------------------------------------------------
// GET /portal/property/:id/media
// ---------------------------------------------------------------------------
router.get("/portal/property/:id/media", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals;
  const propertyId = Number(req.params.id);

  // Verify property belongs to this customer
  const [property] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(
      eq(propertiesTable.id, propertyId),
      eq(propertiesTable.tenantId, portalTenantId),
      eq(propertiesTable.customerId, portalCustomerId),
    ))
    .limit(1);

  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const media = await db
    .select()
    .from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, portalTenantId),
      eq(mediaAttachmentsTable.entityType, "property"),
      eq(mediaAttachmentsTable.entityId, propertyId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);

  // Include signed read URLs so portal <img> elements can display without custom headers
  const mediaWithUrls = await Promise.all(
    media.map(async (row) => {
      let signedUrl: string | null = null;
      try {
        signedUrl = await objectStorageService.generateSignedReadUrl(row.fileKey);
      } catch { /* non-fatal in local dev */ }
      return { ...row, signedUrl };
    }),
  );

  res.json(mediaWithUrls);
});

// ---------------------------------------------------------------------------
// GET /portal/plans
// ---------------------------------------------------------------------------
router.get("/portal/plans", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select({ plan: customerPlansTable, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(
      and(
        eq(customerPlansTable.customerId, portalCustomerId),
        eq(customerPlansTable.tenantId, portalTenantId),
        ne(customerPlansTable.status, "cancelled"),
      ),
    )
    .orderBy(desc(customerPlansTable.createdAt));

  res.json(rows.map(r => formatPortalPlan(r.plan, r.propertyAddress)));
});

// ---------------------------------------------------------------------------
// GET /portal/plans/:id
// ---------------------------------------------------------------------------
router.get("/portal/plans/:id", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const planId = Number(req.params.id);

  const [row] = await db
    .select({ plan: customerPlansTable, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(
      and(
        eq(customerPlansTable.id, planId),
        eq(customerPlansTable.customerId, portalCustomerId),
        eq(customerPlansTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const visits = await db
    .select({ job: jobsTable, assigneeName: usersTable.name })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(eq(jobsTable.tenantId, portalTenantId), eq(jobsTable.planId, planId)))
    .orderBy(jobsTable.scheduledAt);

  const billingHistory = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.tenantId, portalTenantId), eq(invoicesTable.planId, planId)))
    .orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json({
    ...formatPortalPlan(row.plan, row.propertyAddress),
    visits: visits.map(v => ({
      id: v.job.id,
      title: v.job.title,
      status: v.job.status,
      scheduledAt: v.job.scheduledAt.toISOString(),
      assigneeName: v.assigneeName ?? null,
    })),
    billingHistory: billingHistory.map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      total: i.total,
      dueDate: i.dueDate?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      // Include the first line item description so the customer can see
      // area-resolved pricing notes (e.g. "Resolved from property area (8,200 sqft)").
      lineItemNote: (() => {
        const items = (i.lineItems as Array<{ description?: string }> | null) ?? [];
        return items[0]?.description ?? null;
      })(),
    })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /portal/plans/:id — toggle autoRenew only
// ---------------------------------------------------------------------------
router.patch("/portal/plans/:id", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const planId = Number(req.params.id);
  const { autoRenew } = req.body as { autoRenew?: boolean };

  if (typeof autoRenew !== "boolean") {
    res.status(400).json({ error: "autoRenew (boolean) is required" });
    return;
  }

  const [existing] = await db
    .select({ id: customerPlansTable.id })
    .from(customerPlansTable)
    .where(
      and(
        eq(customerPlansTable.id, planId),
        eq(customerPlansTable.customerId, portalCustomerId),
        eq(customerPlansTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const [updated] = await db
    .update(customerPlansTable)
    .set({ autoRenew })
    .where(eq(customerPlansTable.id, planId))
    .returning();

  const [prop] = await db
    .select({ address: propertiesTable.address })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, updated.propertyId))
    .limit(1);

  res.json(formatPortalPlan(updated, prop?.address ?? null));
});

// ---------------------------------------------------------------------------
// POST /portal/invoices/:id/pay-session
// Creates a Stripe Checkout session for a pending/overdue invoice.
// ---------------------------------------------------------------------------
router.post("/portal/invoices/:id/pay-session", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const invoiceId = parseInt(req.params.id, 10);
  const { returnUrl } = req.body as { returnUrl?: string };

  if (!returnUrl) {
    res.status(400).json({ error: "returnUrl is required" });
    return;
  }

  // Verify invoice belongs to this customer and is unpaid
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.id, invoiceId),
        eq(invoicesTable.customerId, portalCustomerId),
        eq(invoicesTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (invoice.status !== "sent" && invoice.status !== "overdue") {
    res.status(400).json({ error: "Invoice is not payable" });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(402).json({ error: "Online payments are not configured. Please contact the office." });
    return;
  }

  const amountCents = Math.round(invoice.total * 100);
  if (amountCents <= 0) {
    res.status(400).json({ error: "Invoice total must be greater than zero" });
    return;
  }

  const successUrl = returnUrl.includes("?")
    ? `${returnUrl}&payment=success`
    : `${returnUrl}?payment=success`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
              description: invoice.notes ?? undefined,
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: returnUrl,
      metadata: {
        invoiceId: String(invoiceId),
        tenantId: String(portalTenantId),
      },
      payment_intent_data: {
        metadata: {
          invoiceId: String(invoiceId),
          tenantId: String(portalTenantId),
        },
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err, invoiceId }, "Stripe Checkout session creation failed");
    res.status(500).json({ error: "Failed to create payment session. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /portal/stripe-webhook
// Stripe sends signed events here. No portal auth — verified by signature.
// ---------------------------------------------------------------------------
router.post("/portal/stripe-webhook", async (req: any, res): Promise<void> => {
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!webhookSecret) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
    res.status(400).json({ error: "Webhook not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body unavailable" });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(400).json({ error: "Stripe not configured" });
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId ? parseInt(session.metadata.invoiceId, 10) : null;
    const tenantId = session.metadata?.tenantId ? parseInt(session.metadata.tenantId, 10) : null;

    if (!invoiceId || !tenantId) {
      logger.warn({ sessionId: session.id }, "Stripe webhook: missing invoiceId/tenantId in metadata");
      res.json({ received: true });
      return;
    }

    if (session.payment_status === "paid") {
      try {
        await db
          .update(invoicesTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(
            and(
              eq(invoicesTable.id, invoiceId),
              eq(invoicesTable.tenantId, tenantId),
            ),
          );
        logger.info({ invoiceId, tenantId }, "Invoice marked paid via Stripe webhook");

        // Fire-and-forget: push payment record to QuickBooks if connected
        syncInvoicePaymentToQBO(tenantId, invoiceId).catch(err =>
          logger.error({ err, invoiceId }, "QB sync fire-and-forget error (Stripe webhook)"),
        );
      } catch (err) {
        logger.error({ err, invoiceId }, "Failed to mark invoice as paid");
        // Still return 200 to Stripe so it doesn't retry
      }
    }
  }

  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// POST /portal/plans/:id/cancel-request
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /portal/estimates
// ---------------------------------------------------------------------------
router.get("/portal/estimates", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select()
    .from(estimatesTable)
    .where(
      and(
        eq(estimatesTable.customerId, portalCustomerId),
        eq(estimatesTable.tenantId, portalTenantId),
        ne(estimatesTable.status, "draft" as string),
      ),
    )
    .orderBy(desc(estimatesTable.createdAt));

  res.json(
    rows.map(e => ({
      id: e.id,
      title: `Estimate #${e.id}`,
      status: e.status,
      total: e.total,
      subtotal: e.subtotal,
      tax: e.tax,
      createdAt: e.createdAt.toISOString(),
      expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
      publicToken: e.approvalToken,
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /portal/estimates/:id  — full detail with optional line-item flags
// ---------------------------------------------------------------------------
router.get("/portal/estimates/:id", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const estimateId = parseInt(req.params.id, 10);
  if (isNaN(estimateId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [estimate] = await db
    .select()
    .from(estimatesTable)
    .where(and(
      eq(estimatesTable.id, estimateId),
      eq(estimatesTable.customerId, portalCustomerId),
      eq(estimatesTable.tenantId, portalTenantId),
      ne(estimatesTable.status, "draft" as string),
    ))
    .limit(1);

  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }

  type RawItem = { id?: string; description?: string; qty?: number; quantity?: number; unitPrice?: number; markup?: number; discount?: number; isOptional?: boolean; optionalPitchLine?: string | null; acceptedByCustomer?: boolean; groupId?: string | null };
  const lineItems = ((estimate.lineItems as RawItem[]) ?? []).map((item, idx) => {
    const qty = item.qty ?? item.quantity ?? 1;
    const unit = item.unitPrice ?? 0;
    const markupMul = 1 + (item.markup ?? 0) / 100;
    const discountMul = 1 - (item.discount ?? 0) / 100;
    return {
      idx,
      itemId: item.id ?? null,
      description: item.description ?? "",
      quantity: qty,
      unitPrice: unit,
      total: Math.round(qty * unit * markupMul * discountMul * 100) / 100,
      isOptional: item.isOptional ?? false,
      optionalPitchLine: item.optionalPitchLine ?? null,
      acceptedByCustomer: item.acceptedByCustomer ?? true,
      groupId: item.groupId ?? null,
    };
  });

  res.json({
    id: estimate.id,
    title: `Estimate #${estimate.id}`,
    status: estimate.status,
    description: null,
    subtotal: estimate.subtotal,
    tax: estimate.tax,
    total: estimate.total,
    lineItems,
    estimatedDurationMin: estimate.estimatedDurationMin ?? null,
    expiresAt: estimate.expiresAt ? estimate.expiresAt.toISOString() : null,
    createdAt: estimate.createdAt.toISOString(),
    publicToken: estimate.approvalToken ?? null,
  });
});

// ---------------------------------------------------------------------------
// PATCH /portal/estimates/:id/optional-items  — save customer's opt-in choices
// ---------------------------------------------------------------------------
router.patch("/portal/estimates/:id/optional-items", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const estimateId = parseInt(req.params.id, 10);
  if (isNaN(estimateId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { selections } = req.body as { selections: boolean[] };
  if (!Array.isArray(selections)) { res.status(400).json({ error: "selections must be an array" }); return; }

  const [estimate] = await db
    .select({ lineItems: estimatesTable.lineItems })
    .from(estimatesTable)
    .where(and(
      eq(estimatesTable.id, estimateId),
      eq(estimatesTable.customerId, portalCustomerId),
      eq(estimatesTable.tenantId, portalTenantId),
      eq(estimatesTable.status, "sent" as string),
    ))
    .limit(1);

  if (!estimate) { res.status(404).json({ error: "Estimate not found or not editable" }); return; }

  type RawItem = Record<string, unknown> & { isOptional?: boolean; groupId?: string | null; acceptedByCustomer?: boolean };
  // Apply the customer's boolean selections
  const withSelections = ((estimate.lineItems as RawItem[]) ?? []).map((item, idx) => {
    if (item.isOptional && idx < selections.length) {
      return { ...item, acceptedByCustomer: selections[idx] };
    }
    return item;
  });

  // Enforce mutual exclusivity: for each group, keep only the first accepted item
  const acceptedGroups = new Set<string>();
  const updated = withSelections.map(item => {
    if (!item.isOptional || !item.groupId || !item.acceptedByCustomer) return item;
    if (acceptedGroups.has(item.groupId)) return { ...item, acceptedByCustomer: false };
    acceptedGroups.add(item.groupId);
    return item;
  });

  // Use raw SQL to bypass Drizzle jsonb mapper quirks.
  // Gate on status = 'sent' so a stale in-flight PATCH cannot overwrite
  // an already-approved estimate; check rowCount to detect the race.
  const result = await db.execute(
    sql`UPDATE estimates SET line_items = ${JSON.stringify(updated)}::jsonb WHERE id = ${estimateId} AND tenant_id = ${portalTenantId} AND status = 'sent'`
  );
  const rowsAffected = (result as any).rowCount ?? 0;
  if (rowsAffected === 0) {
    res.status(409).json({ error: "Estimate is no longer open for editing" });
    return;
  }

  res.json({ ok: true });
});

router.post("/portal/plans/:id/cancel-request", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const planId = Number(req.params.id);
  const { reason } = req.body as { reason?: string };

  // Verify the plan belongs to this customer and is cancellable
  const [row] = await db
    .select({ id: customerPlansTable.id, status: customerPlansTable.status })
    .from(customerPlansTable)
    .where(
      and(
        eq(customerPlansTable.id, planId),
        eq(customerPlansTable.customerId, portalCustomerId),
        eq(customerPlansTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  if (row.status === "cancelled") {
    res.status(409).json({ error: "Plan is already cancelled" });
    return;
  }

  // Check for an existing pending request for this plan
  const [existing] = await db
    .select({ id: planCancelRequestsTable.id })
    .from(planCancelRequestsTable)
    .where(
      and(
        eq(planCancelRequestsTable.planId, planId),
        eq(planCancelRequestsTable.tenantId, portalTenantId),
        eq(planCancelRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "A cancellation request is already pending for this plan" });
    return;
  }

  try {
    await db.insert(planCancelRequestsTable).values({
      tenantId: portalTenantId,
      customerId: portalCustomerId,
      planId,
      reason: reason?.trim() || null,
      status: "pending",
    });
  } catch (err: any) {
    // Unique index violation means a pending request already exists (concurrent submission)
    if (err?.code === "23505") {
      res.status(409).json({ error: "A cancellation request is already pending for this plan" });
      return;
    }
    throw err;
  }

  res.status(201).json({ message: "Cancellation request submitted" });
});

// ---------------------------------------------------------------------------
// POST /portal/messages  — customer sends a message to staff
// ---------------------------------------------------------------------------
router.post("/portal/messages", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const { body } = req.body as { body?: string };
  if (!body?.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }

  const [msg] = await db
    .insert(portalMessagesTable)
    .values({ tenantId: portalTenantId, customerId: portalCustomerId, direction: "inbound", body: body.trim() })
    .returning();

  // Notify all admin/office users for this tenant
  const adminUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.tenantId, portalTenantId),
      eq(usersTable.isActive, true),
      inArray(usersTable.role, ["company_owner", "office_manager", "department_manager"]),
    ));

  const [customer] = await db
    .select({ name: customersTable.name })
    .from(customersTable)
    .where(eq(customersTable.id, portalCustomerId));

  const notifMessage = `New portal message from ${customer?.name ?? "a customer"}`;
  const linkPath = `/portal-inbox/${portalCustomerId}`;

  await Promise.all(
    adminUsers.map(u =>
      db.insert(taskNotificationsTable).values({
        tenantId: portalTenantId,
        recipientUserId: u.id,
        taskId: null,
        type: "portal_message",
        message: notifMessage,
        linkPath,
        isRead: false,
      }).catch(() => { /* best-effort */ }),
    ),
  );

  res.status(201).json({
    id: msg.id,
    direction: msg.direction,
    body: msg.body,
    readAt: null,
    createdAt: msg.createdAt.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /portal/messages  — customer reads their full thread
// ---------------------------------------------------------------------------
router.get("/portal/messages", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const messages = await db
    .select()
    .from(portalMessagesTable)
    .where(and(eq(portalMessagesTable.customerId, portalCustomerId), eq(portalMessagesTable.tenantId, portalTenantId)))
    .orderBy(portalMessagesTable.createdAt);

  // Mark all unread outbound (staff replies) messages as read since the customer is viewing
  const now = new Date();
  await db
    .update(portalMessagesTable)
    .set({ readAt: now })
    .where(
      and(
        eq(portalMessagesTable.customerId, portalCustomerId),
        eq(portalMessagesTable.tenantId, portalTenantId),
        eq(portalMessagesTable.direction, "outbound"),
        isNull(portalMessagesTable.readAt),
      ),
    );

  res.json(messages.map(m => ({
    id: m.id,
    direction: m.direction,
    body: m.body,
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  })));
});

// ---------------------------------------------------------------------------
// POST /portal/jobs/:id/cancel-request
// ---------------------------------------------------------------------------
router.post("/portal/jobs/:id/cancel-request", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const jobId = parseInt(req.params.id, 10);
  const { reason } = req.body as { reason?: string };

  // Verify the job belongs to this customer and is in a cancellable state
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.customerId, portalCustomerId),
        eq(jobsTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "scheduled") {
    res.status(409).json({ error: "Only scheduled jobs can have a cancellation requested" });
    return;
  }

  if ((job as any).cancellationRequestedAt) {
    res.status(409).json({ error: "A cancellation request is already pending for this job" });
    return;
  }

  // Cancellation and reschedule are mutually exclusive pending states.
  if ((job as any).rescheduleRequestedAt) {
    res.status(409).json({ error: "A reschedule request is already pending for this job. Please contact us to change your request." });
    return;
  }

  // ── Atomically mark cancellation requested ─────────────────────────────────
  // Both isNull guards ensure only one request type can win and no concurrent
  // reschedule request can be set in the same window.
  const hoursUntilJob = (new Date(job.scheduledAt).getTime() - Date.now()) / (1000 * 60 * 60);

  const [claimedJob] = await db
    .update(jobsTable)
    .set({
      cancellationRequestedAt: new Date(),
      cancellationReason: reason?.trim() || null,
    } as any)
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.tenantId, portalTenantId),
        isNull((jobsTable as any).cancellationRequestedAt),
        isNull((jobsTable as any).rescheduleRequestedAt),
      ),
    )
    .returning();

  if (!claimedJob) {
    res.status(409).json({ error: "A cancellation or reschedule request is already pending for this job" });
    return;
  }

  // The cancellation fee (if enabled) is applied when staff *approves* the
  // request so that a denied request never leaves the customer charged.

  // Notify all non-technician staff (fire-and-forget is safe here — notifications are non-critical)
  (async () => {
    try {
      const staffUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, portalTenantId), ne(usersTable.role, "technician")));

      if (staffUsers.length > 0) {
        await db.insert(taskNotificationsTable).values(
          staffUsers.map(u => ({
            tenantId: portalTenantId,
            recipientUserId: u.id,
            type: "job_cancel_requested" as string,
            message: `Customer requested cancellation of job "${job.title}"${reason ? `: "${reason.trim()}"` : ""}`,
            linkPath: `/schedule?jobId=${jobId}`,
          })),
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to insert job cancellation request notifications");
    }
  })();

  res.status(201).json({ message: "Cancellation request submitted" });
});

// ---------------------------------------------------------------------------
// POST /portal/jobs/:id/reschedule-request
// ---------------------------------------------------------------------------
router.post("/portal/jobs/:id/reschedule-request", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;
  const jobId = parseInt(req.params.id, 10);
  const { preferredDate, reason } = req.body as { preferredDate?: string; reason?: string };

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.customerId, portalCustomerId),
        eq(jobsTable.tenantId, portalTenantId),
      ),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "scheduled") {
    res.status(409).json({ error: "Only scheduled jobs can have a reschedule requested" });
    return;
  }

  if ((job as any).rescheduleRequestedAt) {
    res.status(409).json({ error: "A reschedule request is already pending for this job" });
    return;
  }

  // Cancellation and reschedule are mutually exclusive pending states.
  if ((job as any).cancellationRequestedAt) {
    res.status(409).json({ error: "A cancellation request is already pending for this job. Please contact us to change your request." });
    return;
  }

  // Validate optional preferred date: must be a strict YYYY-MM-DD string and a valid calendar date.
  let cleanPreferredDate: string | null = null;
  if (preferredDate !== undefined && preferredDate !== null && preferredDate !== "") {
    const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateRe.test(preferredDate)) {
      res.status(400).json({ error: "preferredDate must be in YYYY-MM-DD format" });
      return;
    }
    const d = new Date(`${preferredDate}T12:00:00Z`);
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== preferredDate) {
      res.status(400).json({ error: "preferredDate is not a valid calendar date" });
      return;
    }
    cleanPreferredDate = preferredDate;
  }

  const [claimedJob] = await db
    .update(jobsTable)
    .set({
      rescheduleRequestedAt: new Date(),
      reschedulePreferredDate: cleanPreferredDate,
    } as any)
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.tenantId, portalTenantId),
        isNull((jobsTable as any).rescheduleRequestedAt),
        isNull((jobsTable as any).cancellationRequestedAt),
      ),
    )
    .returning();

  if (!claimedJob) {
    res.status(409).json({ error: "A cancellation or reschedule request is already pending for this job" });
    return;
  }

  // Notify all non-technician staff (fire-and-forget)
  (async () => {
    try {
      const staffUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, portalTenantId), ne(usersTable.role, "technician")));

      if (staffUsers.length > 0) {
        const preferredDateLabel = cleanPreferredDate
          ? ` — preferred new date: ${cleanPreferredDate}`
          : "";
        const reasonLabel = reason?.trim() ? `: "${reason.trim()}"` : "";
        await db.insert(taskNotificationsTable).values(
          staffUsers.map(u => ({
            tenantId: portalTenantId,
            recipientUserId: u.id,
            type: "job_reschedule_requested" as string,
            message: `Customer requested reschedule of job "${job.title}"${reasonLabel}${preferredDateLabel}`,
            linkPath: `/schedule?jobId=${jobId}`,
          })),
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to insert job reschedule request notifications");
    }
  })();

  res.status(201).json({ message: "Reschedule request submitted" });
});

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatPortalPlan(p: typeof customerPlansTable.$inferSelect, propertyAddress: string | null | undefined) {
  return {
    id: p.id,
    templateName: p.templateName,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    billingCycle: p.billingCycle,
    customCycleDays: p.customCycleDays ?? null,
    billingPrice: p.billingPrice,
    autoRenew: p.autoRenew,
    status: p.status,
    nextBillingDate: p.nextBillingDate,
    lastBilledAt: p.lastBilledAt?.toISOString() ?? null,
    propertyAddress: propertyAddress ?? null,
    serviceState: (p.serviceState as unknown[]) ?? [],
    createdAt: p.createdAt.toISOString(),
  };
}

function formatPortalJob(j: typeof jobsTable.$inferSelect, propertyAddress: string | null | undefined, assignedToName?: string | null) {
  return {
    id: j.id,
    title: j.title,
    description: j.description ?? null,
    status: j.status,
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    propertyAddress: propertyAddress ?? null,
    totalAmount: j.totalAmount,
    planId: j.planId ?? null,
    assignedToName: assignedToName ?? null,
    cancellationRequestedAt: (j as any).cancellationRequestedAt ? new Date((j as any).cancellationRequestedAt).toISOString() : null,
    cancellationReason: (j as any).cancellationReason ?? null,
    rescheduleRequestedAt: (j as any).rescheduleRequestedAt ? new Date((j as any).rescheduleRequestedAt).toISOString() : null,
    reschedulePreferredDate: (j as any).reschedulePreferredDate ?? null,
  };
}

function formatPortalInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    subtotal: inv.subtotal,
    tax: inv.tax,
    total: inv.total,
    dueDate: inv.dueDate?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    lineItems: (inv.lineItems as unknown[]) ?? [],
    jobParts: [],
    createdAt: inv.createdAt.toISOString(),
  };
}

function formatPortalAlert(alert: typeof customerAlertsTable.$inferSelect, jobTitle: string | null | undefined) {
  return {
    id: alert.id,
    jobId: alert.jobId,
    jobTitle: jobTitle ?? null,
    type: alert.type,
    message: alert.message,
    status: alert.status,
    customerResponse: alert.customerResponse ?? null,
    photoUrl: alert.photoUrl ?? null,
    createdAt: alert.createdAt.toISOString(),
  };
}

export default router;
