import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, customerOtpSessionsTable, customerAlertsTable, mediaAttachmentsTable, tenantsTable, communicationsLogTable, customerPlansTable, usersTable } from "@workspace/db";
import { eq, and, gt, desc, lte, isNotNull, ne, sql } from "drizzle-orm";
import { objectStorageService } from "./storage";
import crypto from "crypto";
import { getTenantId } from "../lib/tenantHelper";
import { sendEmail, buildOtpEmailHtml, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";
import PDFDocument from "pdfkit";

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
// GET /portal/summary
// ---------------------------------------------------------------------------
router.get("/portal/summary", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const now = new Date();

  const [upcomingJobs, recentInvoices, pendingAlerts, openRequests] = await Promise.all([
    db
      .select({ job: jobsTable, propertyAddress: propertiesTable.address })
      .from(jobsTable)
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
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
  ]);

  res.json({
    upcomingJobs: upcomingJobs.map(r => formatPortalJob(r.job, r.propertyAddress)),
    recentInvoices: recentInvoices.map(formatPortalInvoice),
    unreadAlertCount: pendingAlerts.length,
    openRequestCount: openRequests[0]?.count ?? 0,
  });
});

// ---------------------------------------------------------------------------
// GET /portal/jobs
// ---------------------------------------------------------------------------
router.get("/portal/jobs", requirePortalAuth, async (req: any, res): Promise<void> => {
  const { portalCustomerId, portalTenantId } = req.portalLocals as PortalLocals;

  const rows = await db
    .select({ job: jobsTable, propertyAddress: propertiesTable.address })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(
      and(
        eq(jobsTable.customerId, portalCustomerId),
        eq(jobsTable.tenantId, portalTenantId),
      ),
    )
    .orderBy(desc(jobsTable.scheduledAt));

  res.json(rows.map(r => formatPortalJob(r.job, r.propertyAddress)));
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
  const { propertyId, description, preferredDateStart } = req.body as {
    propertyId?: number;
    description?: string;
    preferredDateStart?: string;
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

  const scheduledAt = preferredDateStart ? new Date(preferredDateStart) : new Date();

  const [job] = await db
    .insert(jobsTable)
    .values({
      tenantId: portalTenantId,
      title: "Service Request",
      description,
      status: "pending",
      priority: "normal",
      customerId: portalCustomerId,
      propertyId,
      scheduledAt,
      totalAmount: 0,
      source: "portal",
    })
    .returning();

  // Fetch property address, tenant config, and customer name in parallel for the notification email
  const [propRow, tenantRow, customerRow] = await Promise.all([
    db.select({ address: propertiesTable.address }).from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, portalTenantId)).limit(1),
    db.select({ name: customersTable.name, email: customersTable.email }).from(customersTable).where(eq(customersTable.id, portalCustomerId)).limit(1),
  ]);

  const propertyAddress = propRow[0]?.address ?? null;

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
      const customerName = customerRow[0]?.name ?? "A customer";
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

function formatPortalJob(j: typeof jobsTable.$inferSelect, propertyAddress: string | null | undefined) {
  return {
    id: j.id,
    title: j.title,
    description: j.description ?? null,
    status: j.status,
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    propertyAddress: propertyAddress ?? null,
    totalAmount: j.totalAmount,
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
