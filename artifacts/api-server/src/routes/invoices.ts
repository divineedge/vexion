import { Router, type IRouter } from "express";
import { db, invoicesTable, customersTable, jobsTable, activityLogTable, tenantsTable, integrationSyncLogsTable, customerPlansTable, stopServiceFlagsTable, invoiceTemplatesTable } from "@workspace/db";
import { eq, and, sql, inArray, ne } from "drizzle-orm";
import crypto from "crypto";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { decryptSecretConfig } from "../lib/secretsCrypto";
import { sendLobLetter, type LobConfig } from "../lib/lobProvider";
import { sendReviewRequest } from "../lib/reviewService";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";
import { sendEmail } from "../lib/emailProvider";
import { logger } from "../lib/logger";
import { sendPaymentReminder, type ReminderRule } from "../lib/paymentReminderScheduler";
import { syncInvoicePaymentToQBO } from "../lib/quickbooksSync";
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
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const invoicesImportExportConfig: ImportExportEntityConfig = {
  entityKey: "invoices",
  fields: [
    { key: "invoiceNumber", header: "Invoice Number", required: true, hint: "Used to match an existing invoice" },
    { key: "customerEmail", header: "Customer Email", required: true, hint: "Looked up against existing customers" },
    { key: "status", header: "Status", hint: "draft, sent, paid, overdue" },
    { key: "subtotal", header: "Subtotal" },
    { key: "tax", header: "Tax" },
    { key: "total", header: "Total" },
    { key: "dueDate", header: "Due Date" },
    { key: "notes", header: "Notes" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "invoiceNumber", header: "Invoice Number" },
    { key: "customerName", header: "Customer Name" },
    { key: "customerEmail", header: "Customer Email" },
    { key: "status", header: "Status" },
    { key: "subtotal", header: "Subtotal" },
    { key: "tax", header: "Tax" },
    { key: "total", header: "Total" },
    { key: "dueDate", header: "Due Date" },
    { key: "paidAt", header: "Paid At" },
    { key: "notes", header: "Notes" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(invoicesTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.status) where = and(where, eq(invoicesTable.status, query.status)) as typeof where;
    if (query.customerId) where = and(where, eq(invoicesTable.customerId, parseInt(query.customerId, 10))) as typeof where;

    const rows = await db
      .select({ invoice: invoicesTable, customerName: customersTable.name, customerEmail: customersTable.email })
      .from(invoicesTable)
      .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
      .where(where)
      .orderBy(sql`${invoicesTable.createdAt} DESC`);

    return rows.map((r) => ({
      id: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      customerName: r.customerName ?? "",
      customerEmail: r.customerEmail ?? "",
      status: r.invoice.status,
      subtotal: r.invoice.subtotal,
      tax: r.invoice.tax,
      total: r.invoice.total,
      dueDate: r.invoice.dueDate?.toISOString() ?? "",
      paidAt: r.invoice.paidAt?.toISOString() ?? "",
      notes: r.invoice.notes ?? "",
      createdAt: r.invoice.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const invoiceNumber = requireString(raw.invoiceNumber, "Invoice Number", errors);
    const customerEmail = requireString(raw.customerEmail, "Customer Email", errors);
    if (errors.length > 0 || !invoiceNumber || !customerEmail) return { ok: false, errors };

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${customerEmail})`))
      .limit(1);
    if (!customer) return { ok: false, errors: [`No customer found with email "${customerEmail}"`] };

    const subtotal = optionalNumber(raw.subtotal, "Subtotal", errors) ?? 0;
    const tax = optionalNumber(raw.tax, "Tax", errors) ?? 0;
    const total = optionalNumber(raw.total, "Total", errors) ?? subtotal + tax;
    const dueDate = optionalDate(raw.dueDate, "Due Date", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        invoiceNumber,
        customerId: customer.id,
        status: optionalString(raw.status) ?? "draft",
        subtotal,
        tax,
        total,
        dueDate: dueDate ?? null,
        notes: optionalString(raw.notes) ?? null,
      },
    };
  },
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.invoiceNumber, values.invoiceNumber as string)))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const [row] = await db.insert(invoicesTable).values({ tenantId, ...values } as typeof invoicesTable.$inferInsert).returning({ id: invoicesTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    await db.update(invoicesTable).set(values as Partial<typeof invoicesTable.$inferInsert>)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));
  },
};
registerImportExportConfig(invoicesImportExportConfig);

router.get("/invoices/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), invoicesImportExportConfig);
});

router.post("/invoices/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), invoicesImportExportConfig);
});

router.post("/invoices/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), invoicesImportExportConfig);
});

function formatInvoice(i: typeof invoicesTable.$inferSelect, customerName?: string | null) {
  return {
    ...i,
    lineItems: (i.lineItems as unknown[]) ?? [],
    customerName: customerName ?? null,
    planId: i.planId ?? null,
    invoiceDate: i.invoiceDate ?? null,
    dueDate: i.dueDate?.toISOString() ?? null,
    paidAt: i.paidAt?.toISOString() ?? null,
    stripePaymentUrl: i.stripePaymentUrl ?? null,
    publicToken: i.publicToken ?? null,
    createdAt: i.createdAt.toISOString(),
    // Template-derived fields
    layout: i.layout ?? "clean",
    termsText: i.termsText ?? null,
    lateFeeEnabled: i.lateFeeEnabled ?? false,
    lateFeeType: i.lateFeeType ?? null,
    lateFeeAmount: i.lateFeeAmount ?? null,
    lateFeeDaysGrace: i.lateFeeDaysGrace ?? 0,
  };
}

function generateInvoiceToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

router.get("/invoices/financials-summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const [paid] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "paid")));
  const [outstanding] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), sql`status IN ('draft','sent')`));
  const [overdue] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "overdue")));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [paidMonth] = await db.select({ total: sql<number>`COALESCE(sum(total),0)::float` }).from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.status, "paid"), sql`paid_at >= ${startOfMonth}`));

  const [avg] = await db.select({ avg: sql<number>`COALESCE(avg(total),0)::float` }).from(invoicesTable).where(eq(invoicesTable.tenantId, tenantId));

  res.json({
    totalRevenue: paid?.total ?? 0,
    totalOutstanding: outstanding?.total ?? 0,
    totalOverdue: overdue?.total ?? 0,
    paidThisMonth: paidMonth?.total ?? 0,
    averageInvoiceValue: avg?.avg ?? 0,
  });
});

router.get("/invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, customerId } = req.query as Record<string, string>;

  let where = eq(invoicesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(invoicesTable.status, status)) as typeof where;
  if (customerId) where = and(where, eq(invoicesTable.customerId, parseInt(customerId, 10))) as typeof where;

  const rows = await db
    .select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(where)
    .orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json(rows.map(r => formatInvoice(r.invoice, r.customerName)));
});

router.post("/invoices/from-job/:jobId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  // Resolve tenant default invoice template (from-job always uses tenant default)
  const [tenant] = await db.select({ defaultInvoiceTemplateId: tenantsTable.defaultInvoiceTemplateId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const resolvedTemplateId = tenant?.defaultInvoiceTemplateId ?? null;

  let templateFields = {
    layout: "clean",
    termsText: null as string | null,
    lateFeeEnabled: false,
    lateFeeType: null as string | null,
    lateFeeAmount: null as number | null,
    lateFeeDaysGrace: 0,
  };

  if (resolvedTemplateId) {
    const [tmpl] = await db.select().from(invoiceTemplatesTable).where(and(eq(invoiceTemplatesTable.id, resolvedTemplateId), eq(invoiceTemplatesTable.tenantId, tenantId)));
    if (tmpl) {
      templateFields = {
        layout: tmpl.layout,
        termsText: tmpl.termsText ?? null,
        lateFeeEnabled: tmpl.lateFeeEnabled,
        lateFeeType: tmpl.lateFeeType ?? null,
        lateFeeAmount: tmpl.lateFeeAmount ?? null,
        lateFeeDaysGrace: tmpl.lateFeeDaysGrace,
      };
    }
  }

  const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;
  const lineItems = (job.lineItems as unknown[]) ?? [];
  const subtotal = job.totalAmount;
  const tax = subtotal * 0.085;
  const total = subtotal + tax;

  const [invoice] = await db.insert(invoicesTable).values({
    tenantId,
    invoiceNumber: invoiceNum,
    customerId: job.customerId!,
    jobId: job.id,
    status: "draft",
    subtotal,
    tax,
    total,
    lineItems,
    invoiceTemplateId: resolvedTemplateId,
    layout: templateFields.layout,
    termsText: templateFields.termsText,
    lateFeeEnabled: templateFields.lateFeeEnabled,
    lateFeeType: templateFields.lateFeeType,
    lateFeeAmount: templateFields.lateFeeAmount,
    lateFeeDaysGrace: templateFields.lateFeeDaysGrace,
  }).returning();

  await db.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, jobId));
  await db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_sent", message: `Invoice ${invoiceNum} created from job`, entityId: invoice.id });

  res.status(201).json(formatInvoice(invoice));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, jobId, notes, dueDate, invoiceDate, lineItems: bodyLineItems, invoiceTemplateId } = req.body;
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }

  // Resolve template — explicit invoiceTemplateId > tenant default
  let resolvedTemplateId: number | null = invoiceTemplateId ? parseInt(invoiceTemplateId, 10) : null;
  if (!resolvedTemplateId) {
    const [tenant] = await db.select({ defaultInvoiceTemplateId: tenantsTable.defaultInvoiceTemplateId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    resolvedTemplateId = tenant?.defaultInvoiceTemplateId ?? null;
  }

  let templateFields: {
    layout: string;
    termsText: string | null;
    lateFeeEnabled: boolean;
    lateFeeType: string | null;
    lateFeeAmount: number | null;
    lateFeeDaysGrace: number;
    templateLineItems: unknown[];
  } = {
    layout: "clean",
    termsText: null,
    lateFeeEnabled: false,
    lateFeeType: null,
    lateFeeAmount: null,
    lateFeeDaysGrace: 0,
    templateLineItems: [],
  };

  if (resolvedTemplateId) {
    const [tmpl] = await db.select().from(invoiceTemplatesTable).where(and(eq(invoiceTemplatesTable.id, resolvedTemplateId), eq(invoiceTemplatesTable.tenantId, tenantId)));
    if (tmpl) {
      templateFields = {
        layout: tmpl.layout,
        termsText: tmpl.termsText ?? null,
        lateFeeEnabled: tmpl.lateFeeEnabled,
        lateFeeType: tmpl.lateFeeType ?? null,
        lateFeeAmount: tmpl.lateFeeAmount ?? null,
        lateFeeDaysGrace: tmpl.lateFeeDaysGrace,
        templateLineItems: (tmpl.lineItems as unknown[]) ?? [],
      };
    }
  }

  // Caller-supplied line items override template line items; template line items are
  // only used when the caller sends none.
  const lineItems = (bodyLineItems !== undefined && bodyLineItems !== null)
    ? bodyLineItems
    : templateFields.templateLineItems;

  const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;
  const subtotal = (lineItems as { unitPrice: number; quantity: number }[]).reduce((sum, li) => sum + (li.unitPrice * li.quantity), 0);
  const tax = subtotal * 0.085;
  const total = subtotal + tax;

  const [invoice] = await db.insert(invoicesTable).values({
    tenantId,
    invoiceNumber: invoiceNum,
    customerId: parseInt(customerId, 10),
    jobId: jobId ? parseInt(jobId, 10) : null,
    status: "draft",
    subtotal,
    tax,
    total,
    notes: notes ?? null,
    invoiceDate: invoiceDate ? invoiceDate : null,
    dueDate: dueDate ? new Date(dueDate) : null,
    lineItems,
    invoiceTemplateId: resolvedTemplateId,
    layout: templateFields.layout,
    termsText: templateFields.termsText,
    lateFeeEnabled: templateFields.lateFeeEnabled,
    lateFeeType: templateFields.lateFeeType,
    lateFeeAmount: templateFields.lateFeeAmount,
    lateFeeDaysGrace: templateFields.lateFeeDaysGrace,
  }).returning();

  res.status(201).json(formatInvoice(invoice));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatInvoice(row.invoice, row.customerName));
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { status, notes, dueDate, lineItems } = req.body;
  const updates: Partial<typeof invoicesTable.$inferInsert> = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  if (status === "paid") { updates.paidAt = new Date(); }
  // Full line-item replacement — recalculate subtotal and total, preserve existing tax rate
  if (lineItems !== undefined && Array.isArray(lineItems)) {
    const items = lineItems as { description: string; quantity: number; unitPrice: number; total?: number }[];
    const newSubtotal = items.reduce((s, li) => s + (li.quantity * li.unitPrice), 0);
    // Fetch existing to derive tax and tenant tax rate
    const [existing] = await db.select({ tax: invoicesTable.tax, total: invoicesTable.total, subtotal: invoicesTable.subtotal, tenantId: invoicesTable.tenantId })
      .from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));
    const oldTax = existing?.tax ?? 0;
    const oldSubtotal = existing?.subtotal ?? 0;
    // Preserve tax proportionally if there was a non-zero rate; otherwise zero
    const taxRate = oldSubtotal > 0 ? oldTax / oldSubtotal : 0;
    const newTax = Math.round(newSubtotal * taxRate * 100) / 100;
    updates.lineItems = items.map(li => ({ ...li, total: li.quantity * li.unitPrice }));
    updates.subtotal = newSubtotal;
    updates.tax = newTax;
    updates.total = newSubtotal + newTax;
  }
  // Generate a public token the first time an invoice is sent so customers can view it via a shareable link
  let newlyMadeSent = false;
  if (status === "sent") {
    const [existing] = await db.select({ publicToken: invoicesTable.publicToken, status: invoicesTable.status }).from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));
    if (!existing?.publicToken) {
      updates.publicToken = generateInvoiceToken();
    }
    if (existing?.status !== "sent") newlyMadeSent = true;
  }

  const [updated] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId))).returning();

  // Auto-send the invoice email link when first marked as "sent"
  if (newlyMadeSent && updated) {
    await enqueueInvoiceEmail(tenantId, id).catch(err => logger.error({ err, invoiceId: id }, "Failed to auto-enqueue invoice email on status=sent"));
  }
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (status === "paid") {
    await db.insert(activityLogTable).values({ tenantId, userId, type: "payment_received", message: `Invoice ${updated.invoiceNumber} marked as paid`, entityId: id });

    // Fire-and-forget: push payment record to QuickBooks if the integration is connected
    syncInvoicePaymentToQBO(tenantId, id).catch(err => logger.error({ err, invoiceId: id }, "QB sync fire-and-forget error"));

    // Auto-send a review request, if the tenant has this trigger enabled.
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (tenant?.reviewRequestOnInvoicePaid) {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId));
      if (customer) {
        sendReviewRequest({ tenant, customer, jobId: updated.jobId, invoiceId: updated.id })
          .catch(err => logger.error({ err, invoiceId: updated.id }, "Failed to send review request on invoice paid"));
      }
    }

    // Auto-resume a paused plan when its overdue invoice is paid.
    // Only trigger when this invoice has an active (pending or approved) stop-service flag,
    // which is the authoritative record that THIS invoice caused the plan to pause.
    if (updated.planId) {
      try {
        const [plan] = await db
          .select()
          .from(customerPlansTable)
          .where(and(eq(customerPlansTable.id, updated.planId), eq(customerPlansTable.tenantId, tenantId)));

        if (plan && plan.status === "paused") {
          // Check for an active stop-service flag tied to this invoice. If none exists,
          // this payment is not the one that triggered the pause — do not resume.
          const activeFlags = await db
            .select({ id: stopServiceFlagsTable.id })
            .from(stopServiceFlagsTable)
            .where(
              and(
                eq(stopServiceFlagsTable.tenantId, tenantId),
                eq(stopServiceFlagsTable.invoiceId, id),
                inArray(stopServiceFlagsTable.status, ["pending", "approved"]),
              ),
            );

          if (activeFlags.length > 0) {
            // Dismiss all active stop-service flags for this invoice.
            await db
              .update(stopServiceFlagsTable)
              .set({ status: "dismissed", resolvedBy: userId, resolvedAt: new Date() })
              .where(
                and(
                  eq(stopServiceFlagsTable.tenantId, tenantId),
                  eq(stopServiceFlagsTable.invoiceId, id),
                  inArray(stopServiceFlagsTable.status, ["pending", "approved"]),
                ),
              );

            // Check whether other invoices on this plan still have unresolved stop-service flags.
            // If any remain, the overdue condition is not fully cleared — keep the plan paused.
            const otherPlanInvoices = await db
              .select({ id: invoicesTable.id })
              .from(invoicesTable)
              .where(
                and(
                  eq(invoicesTable.tenantId, tenantId),
                  eq(invoicesTable.planId, updated.planId!),
                  ne(invoicesTable.id, id),
                ),
              );

            const remainingFlags =
              otherPlanInvoices.length > 0
                ? await db
                    .select({ id: stopServiceFlagsTable.id })
                    .from(stopServiceFlagsTable)
                    .where(
                      and(
                        eq(stopServiceFlagsTable.tenantId, tenantId),
                        inArray(
                          stopServiceFlagsTable.invoiceId,
                          otherPlanInvoices.map((inv) => inv.id),
                        ),
                        inArray(stopServiceFlagsTable.status, ["pending", "approved"]),
                      ),
                    )
                : [];

            if (remainingFlags.length === 0) {
              // No other overdue invoices are blocking the plan — safe to resume.
              await db
                .update(customerPlansTable)
                .set({ status: "active" })
                .where(eq(customerPlansTable.id, plan.id));

              // Activity log entry for the auto-resume.
              await db.insert(activityLogTable).values({
                tenantId,
                userId,
                type: "plan_resumed",
                message: `Plan "${plan.templateName}" auto-resumed after invoice ${updated.invoiceNumber} was marked paid`,
                entityId: plan.id,
              });

              // Notify the customer by email.
              try {
                const [customer] = await db
                  .select({ email: customersTable.email, name: customersTable.name })
                  .from(customersTable)
                  .where(and(eq(customersTable.id, updated.customerId), eq(customersTable.tenantId, tenantId)));

                const [planTenant] = await db
                  .select({
                    emailProvider: tenantsTable.emailProvider,
                    emailProviderConfig: tenantsTable.emailProviderConfig,
                    businessEmail: tenantsTable.businessEmail,
                    name: tenantsTable.name,
                  })
                  .from(tenantsTable)
                  .where(eq(tenantsTable.id, tenantId));

                if (customer?.email) {
                  const providerConfig = {
                    provider: (planTenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
                    config: (planTenant?.emailProviderConfig as Record<string, string>) ?? {},
                    fromAddress:
                      planTenant?.businessEmail ??
                      (planTenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ??
                      null,
                  };
                  const subject = `Your "${plan.templateName}" plan has been resumed`;
                  const body = [
                    `Hi ${customer.name},`,
                    "",
                    `Great news! We received your payment and your "${plan.templateName}" service plan has been resumed. Your upcoming visits will continue as scheduled.`,
                    "",
                    "If you have any questions, please don't hesitate to contact us.",
                    "",
                    "Thank you,",
                    planTenant?.name ?? "Your Service Provider",
                  ].join("\n");

                  await sendEmail(providerConfig, customer.email, subject, body).catch((err) =>
                    logger.warn({ err, planId: plan.id }, "Plan auto-resume notification email failed"),
                  );
                }
              } catch (err) {
                logger.warn({ err, planId: plan.id }, "Plan auto-resume: failed to send customer notification email");
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err, invoiceId: id }, "Invoice paid: plan auto-resume failed");
      }
    }
  }

  res.json(formatInvoice(updated));
});

// POST /invoices/:id/send-reminder — on-demand payment reminder for one invoice
router.post("/invoices/:id/send-reminder", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ invoice: invoicesTable, customer: customersTable, tenant: tenantsTable })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(tenantsTable, eq(invoicesTable.tenantId, tenantsTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));

  if (!row?.invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!row.customer) { res.status(400).json({ error: "Customer not found for this invoice" }); return; }
  if (!row.tenant) { res.status(400).json({ error: "Tenant not found" }); return; }

  if (row.invoice.status === "paid") {
    res.status(400).json({ error: "Invoice is already paid — no reminder needed" });
    return;
  }

  const schedule = (row.tenant.paymentReminderSchedule as ReminderRule[]) ?? [];
  if (!row.tenant.paymentRemindersEnabled || schedule.length === 0) {
    res.status(400).json({ error: "Payment reminders are not configured for this account" });
    return;
  }

  const alreadySent = (row.invoice.paymentRemindersSent as number[] | null) ?? [];

  // Find the next unsent rule (lowest offsetDays not yet sent), bypassing the date threshold
  const nextRule = schedule
    .filter(r => !alreadySent.includes(r.offsetDays))
    .sort((a, b) => a.offsetDays - b.offsetDays)[0];

  if (!nextRule) {
    res.status(400).json({ error: "All configured reminders have already been sent for this invoice" });
    return;
  }

  const legacyChannels = (row.tenant.paymentReminderChannels as string[]) ?? ["email"];
  const channels = nextRule.channels && nextRule.channels.length > 0 ? nextRule.channels : legacyChannels;

  const delivered = await sendPaymentReminder({
    tenant: row.tenant,
    customer: row.customer,
    invoice: row.invoice,
    rule: nextRule,
    channels,
  });

  if (delivered) {
    await db.execute(sql`
      UPDATE invoices
      SET payment_reminders_sent = COALESCE(payment_reminders_sent, '[]'::jsonb) || ${JSON.stringify([nextRule.offsetDays])}::jsonb
      WHERE id = ${id}
        AND NOT (COALESCE(payment_reminders_sent, '[]'::jsonb) @> ${JSON.stringify([nextRule.offsetDays])}::jsonb)
    `);
    logger.info({ tenantId, invoiceId: id, offsetDays: nextRule.offsetDays }, "On-demand payment reminder sent");
  } else {
    logger.warn({ tenantId, invoiceId: id, offsetDays: nextRule.offsetDays }, "On-demand payment reminder not delivered on any channel");
  }

  res.json({
    ok: true,
    delivered,
    message: delivered
      ? `Reminder sent via ${channels.join(" and ")} (${nextRule.label})`
      : "Reminder could not be delivered — check your email/SMS provider settings",
  });
});

// POST /invoices/:id/print-mail — send a physical copy of the invoice via Lob
router.post("/invoices/:id/print-mail", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select({ invoice: invoicesTable, customer: customersTable, tenant: tenantsTable })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(tenantsTable, eq(invoicesTable.tenantId, tenantsTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));
  if (!row?.invoice || !row.customer || !row.tenant) { res.status(404).json({ error: "Not found" }); return; }
  if (!row.customer.billingAddress || !row.customer.billingCity || !row.customer.billingState || !row.customer.billingZip) {
    res.status(400).json({ error: "Customer is missing a complete billing address" });
    return;
  }

  const states = (row.tenant.integrationsConfig as Record<string, { connected: boolean; encryptedConfig?: string }>) ?? {};
  const lobState = states.lob;
  if (!lobState?.connected) { res.status(400).json({ error: "Lob is not connected. Connect it in Settings → Integrations first." }); return; }
  const config = decryptSecretConfig(lobState.encryptedConfig) as LobConfig;

  const lineItems = (row.invoice.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>) ?? [];
  const html = `
    <html><body style="font-family: sans-serif; padding: 40px;">
      <h2>${row.tenant.name}</h2>
      <p><strong>Invoice ${row.invoice.invoiceNumber}</strong></p>
      <p>Bill To: ${row.customer.name}</p>
      <table style="width:100%; border-collapse: collapse;">
        ${lineItems.map(li => `<tr><td>${li.description}</td><td style="text-align:right;">${li.quantity} x ${li.unitPrice.toFixed(2)}</td></tr>`).join("")}
      </table>
      <p style="text-align:right; font-size: 1.2em;"><strong>Total: ${row.invoice.total.toFixed(2)}</strong></p>
    </body></html>
  `;

  const result = await sendLobLetter(config, {
    to: {
      name: row.customer.name,
      address_line1: row.customer.billingAddress,
      address_city: row.customer.billingCity,
      address_state: row.customer.billingState,
      address_zip: row.customer.billingZip,
    },
    from: {
      name: row.tenant.name,
      address_line1: row.customer.billingAddress, // Placeholder sender address until a dedicated company mailing address field exists
      address_city: row.customer.billingCity,
      address_state: row.customer.billingState,
      address_zip: row.customer.billingZip,
    },
    html,
    description: `Invoice ${row.invoice.invoiceNumber}`,
  });

  await db.insert(integrationSyncLogsTable).values({
    tenantId, integration: "lob", action: "push",
    status: result.success ? "success" : "error",
    message: result.success ? `Mailed invoice ${row.invoice.invoiceNumber}` : result.error,
  });

  if (!result.success) { res.status(502).json({ error: result.error }); return; }

  const [updated] = await db.update(invoicesTable)
    .set({ lobLetterId: result.letterId, lobStatus: result.status ?? "requested" })
    .where(eq(invoicesTable.id, id))
    .returning();

  res.json(formatInvoice(updated, row.customer.name));
});

// ── POST /invoices/:id/resend-email — re-enqueue the invoice email ────────────
router.post("/invoices/:id/resend-email", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/admin/office roles" });
    return;
  }
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ invoice: invoicesTable, customerEmail: customersTable.email })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!row.customerEmail) { res.status(400).json({ error: "Customer has no email address on file" }); return; }

  await enqueueInvoiceEmail(tenantId, id);
  await db.insert(activityLogTable).values({
    tenantId,
    userId,
    type: "invoice_email_resent",
    message: `Invoice ${row.invoice.invoiceNumber} email manually re-queued by staff`,
    entityId: id,
  });

  res.json({ ok: true });
});

// ── PUBLIC: GET INVOICE BY TOKEN ──────────────────────────────────────────────
router.get("/public/invoices/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({
      invoice: invoicesTable,
      customerName: customersTable.name,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(eq(invoicesTable.publicToken, token));

  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, row.invoice.tenantId));

  res.json({
    ...formatInvoice(row.invoice, row.customerName),
    publicToken: undefined, // don't expose token in response
    businessProfile: {
      companyName: tenant?.name ?? null,
      logoUrl: tenant?.logoUrl ?? null,
      tagline: tenant?.businessTagline ?? null,
      phone: tenant?.businessPhone ?? null,
      email: tenant?.businessEmail ?? null,
      website: tenant?.businessWebsite ?? null,
      address: tenant?.businessAddress ?? null,
      invoiceFooterText: tenant?.invoiceFooterText ?? null,
    },
  });
});

export default router;
