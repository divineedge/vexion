/**
 * Billing Scheduler
 * Runs daily and handles two automation pipelines:
 *   1. Recurring Invoice Templates — generate invoices for templates whose
 *      nextBillingDate is today or earlier.
 *   2. Email Queue — send pending billing emails with retry logic (max 3 attempts).
 */

import { db, recurringInvoiceTemplatesTable, billingEmailQueueTable, invoicesTable, customersTable, tenantsTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendEmail } from "./emailProvider";

const MAX_EMAIL_ATTEMPTS = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayDateString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10); // "yyyy-mm-dd"
}

function addMonth(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function addWeek(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function nextBillingDate(current: string, cycleType: string): string {
  return cycleType === "weekly" ? addWeek(current) : addMonth(current);
}

function generateInvoiceNumber(): string {
  return `INV-${Date.now().toString().slice(-8)}`;
}

// ── 1. Process recurring templates ───────────────────────────────────────────

async function processRecurringTemplates() {
  const today = todayDateString();

  const templates = await db
    .select({
      template: recurringInvoiceTemplatesTable,
      customerEmail: customersTable.email,
      customerName: customersTable.name,
    })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .where(
      and(
        eq(recurringInvoiceTemplatesTable.isActive, true),
        lte(recurringInvoiceTemplatesTable.nextBillingDate, today),
      ),
    );

  let generated = 0;

  for (const { template, customerEmail, customerName } of templates) {
    try {
      await db.transaction(async tx => {
        const lineItems = (template.lineItems as Array<{
          description: string; quantity: number; unitPrice: number; total: number;
        }>) ?? [];
        const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);

        // Fetch tenant for tax rate
        const [tenant] = await tx
          .select({ taxRate: tenantsTable.taxRate })
          .from(tenantsTable)
          .where(eq(tenantsTable.id, template.tenantId));
        const taxRate = tenant?.taxRate ?? 0;
        const tax = subtotal * (taxRate / 100);
        const total = subtotal + tax;

        const invoiceNum = generateInvoiceNumber();

        const [invoice] = await tx
          .insert(invoicesTable)
          .values({
            tenantId: template.tenantId,
            invoiceNumber: invoiceNum,
            customerId: template.customerId,
            status: "sent",
            subtotal,
            tax,
            total,
            lineItems: template.lineItems,
            notes: template.notes ?? null,
            generatedFromTemplateId: template.id,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // net-30
          })
          .returning();

        // Enqueue email
        await tx.insert(billingEmailQueueTable).values({
          tenantId: template.tenantId,
          invoiceId: invoice.id,
          status: "pending",
          attempts: 0,
        });

        // Advance next billing date
        const nextDate = nextBillingDate(template.nextBillingDate, template.billingCycleType);
        await tx
          .update(recurringInvoiceTemplatesTable)
          .set({ nextBillingDate: nextDate, lastGeneratedAt: new Date() })
          .where(eq(recurringInvoiceTemplatesTable.id, template.id));

        generated++;
        logger.info(
          { templateId: template.id, invoiceId: invoice.id, customerId: template.customerId },
          "Generated recurring invoice",
        );
      });
    } catch (err) {
      logger.error({ err, templateId: template.id }, "Failed to generate recurring invoice");
    }
  }

  if (generated > 0) {
    logger.info({ generated }, "Billing scheduler: generated recurring invoices");
  }
}

// ── 2. Process email queue ───────────────────────────────────────────────────

async function processEmailQueue() {
  const pending = await db
    .select({
      queue: billingEmailQueueTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceTotal: invoicesTable.total,
      customerId: invoicesTable.customerId,
      customerEmail: customersTable.email,
      customerName: customersTable.name,
      emailProvider: tenantsTable.emailProvider,
      emailProviderConfig: tenantsTable.emailProviderConfig,
      tenantName: tenantsTable.name,
    })
    .from(billingEmailQueueTable)
    .leftJoin(invoicesTable, eq(billingEmailQueueTable.invoiceId, invoicesTable.id))
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(tenantsTable, eq(billingEmailQueueTable.tenantId, tenantsTable.id))
    .where(
      and(
        eq(billingEmailQueueTable.status, "pending"),
        sql`${billingEmailQueueTable.attempts} < ${MAX_EMAIL_ATTEMPTS}`,
      ),
    );

  for (const row of pending) {
    if (!row.customerEmail) continue;

    const providerConfig = {
      provider: row.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null,
      config: (row.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: (row.emailProviderConfig as Record<string, string>)?.fromAddress ?? null,
    };

    const subject = `Invoice ${row.invoiceNumber} — $${(row.invoiceTotal ?? 0).toFixed(2)}`;
    const body = [
      `Dear ${row.customerName ?? "Valued Customer"},`,
      "",
      `Please find your invoice ${row.invoiceNumber} for $${(row.invoiceTotal ?? 0).toFixed(2)} attached to your account.`,
      "",
      "Payment is due within 30 days.",
      "",
      `Thank you for your business,`,
      row.tenantName ?? "Your Service Provider",
    ].join("\n");

    const result = await sendEmail(providerConfig, row.customerEmail, subject, body);

    await db
      .update(billingEmailQueueTable)
      .set({
        attempts: sql`${billingEmailQueueTable.attempts} + 1`,
        lastAttemptAt: new Date(),
        status: result.success ? "sent" : (row.queue.attempts + 1 >= MAX_EMAIL_ATTEMPTS ? "failed" : "pending"),
        errorMsg: result.error ?? null,
      })
      .where(eq(billingEmailQueueTable.id, row.queue.id));

    if (result.success) {
      logger.info({ queueId: row.queue.id, invoiceId: row.queue.invoiceId }, "Billing email sent");
    } else {
      logger.warn({ queueId: row.queue.id, error: result.error }, "Billing email failed");
    }
  }
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

async function runBillingCycle() {
  logger.info("Billing scheduler: starting daily cycle");
  await processRecurringTemplates();
  await processEmailQueue();
  logger.info("Billing scheduler: daily cycle complete");
}

export function startBillingScheduler() {
  logger.info("Starting billing scheduler (runs every 24 hours)");

  // Run immediately on startup (catches up any missed runs)
  void runBillingCycle().catch(err => logger.error({ err }, "Billing scheduler error"));

  // Then run every 24 hours
  const interval = setInterval(() => {
    void runBillingCycle().catch(err => logger.error({ err }, "Billing scheduler error"));
  }, 24 * 60 * 60 * 1000);

  interval.unref();
}

/** Manually trigger a single recurring template. Used by the "Generate Now" API. */
export async function runTemplateNow(templateId: number, tenantId: number): Promise<{ invoiceId: number }> {
  const [row] = await db
    .select({
      template: recurringInvoiceTemplatesTable,
      customerEmail: customersTable.email,
      customerName: customersTable.name,
    })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .where(
      and(
        eq(recurringInvoiceTemplatesTable.id, templateId),
        eq(recurringInvoiceTemplatesTable.tenantId, tenantId),
      ),
    );

  if (!row) throw new Error("Template not found");

  const { template } = row;

  const lineItems = (template.lineItems as Array<{
    description: string; quantity: number; unitPrice: number; total: number;
  }>) ?? [];
  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);

  const [tenant] = await db
    .select({ taxRate: tenantsTable.taxRate })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const taxRate = tenant?.taxRate ?? 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const invoiceNum = generateInvoiceNumber();

  let invoiceId!: number;
  await db.transaction(async tx => {
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        tenantId,
        invoiceNumber: invoiceNum,
        customerId: template.customerId,
        status: "sent",
        subtotal,
        tax,
        total,
        lineItems: template.lineItems,
        notes: template.notes ?? null,
        generatedFromTemplateId: template.id,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    invoiceId = invoice.id;

    await tx.insert(billingEmailQueueTable).values({
      tenantId,
      invoiceId: invoice.id,
      status: "pending",
      attempts: 0,
    });

    await tx
      .update(recurringInvoiceTemplatesTable)
      .set({ lastGeneratedAt: new Date() })
      .where(eq(recurringInvoiceTemplatesTable.id, template.id));
  });

  // Process email queue immediately for this invoice
  await processEmailQueue();

  return { invoiceId };
}

/** Enqueue an auto-invoice email for immediate delivery. */
export async function enqueueInvoiceEmail(tenantId: number, invoiceId: number): Promise<void> {
  await db.insert(billingEmailQueueTable).values({
    tenantId,
    invoiceId,
    status: "pending",
    attempts: 0,
  });
  // Attempt delivery immediately
  await processEmailQueue();
}
