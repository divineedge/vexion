import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, customersTable, propertiesTable, jobsTable, invoicesTable, customerOtpSessionsTable, customerAlertsTable, mediaAttachmentsTable, tenantsTable } from "@workspace/db";
import { eq, and, gt, desc, lte, isNotNull } from "drizzle-orm";
import { objectStorageService } from "./storage";
import crypto from "crypto";
import { getTenantId } from "../lib/tenantHelper";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

  const emailResult = await sendEmail(emailProviderConfig, email.toLowerCase().trim(), subject, body);

  if (!emailResult.success) {
    logger.error({ to: email, error: emailResult.error }, "Failed to send portal OTP email");
    res.status(500).json({ error: "Failed to send login code. Please try again or contact support." });
    return;
  }

  // Return previewOtp only in development so engineers can test without a real email service.
  const isDev = process.env.NODE_ENV !== "production";
  res.json({ message: "OTP sent to your email", previewOtp: isDev ? otp : undefined });
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

  const [upcomingJobs, recentInvoices, pendingAlerts] = await Promise.all([
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
  ]);

  res.json({
    upcomingJobs: upcomingJobs.map(r => formatPortalJob(r.job, r.propertyAddress)),
    recentInvoices: recentInvoices.map(formatPortalInvoice),
    unreadAlertCount: pendingAlerts.length,
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
  res.json(formatPortalAlert(updated, job?.title ?? null));
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
    })
    .returning();

  const [prop] = await db.select({ address: propertiesTable.address }).from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1);
  res.status(201).json(formatPortalJob(job, prop?.address ?? null));
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
// Format helpers
// ---------------------------------------------------------------------------

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
