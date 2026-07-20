/**
 * Billing Scheduler
 * Runs daily and handles two automation pipelines:
 *   1. Recurring Invoice Templates — generate invoices for templates whose
 *      nextBillingDate is today or earlier. Templates in 'static' billingMode
 *      bill the same hand-entered line items every cycle; templates in
 *      'completed_work' mode build line items from the customer's/service's
 *      jobs completed since the template's last billing run.
 *   2. Email Queue — send pending billing emails with retry logic (max 3 attempts).
 */

import { db, recurringInvoiceTemplatesTable, billingEmailQueueTable, invoicesTable, customersTable, tenantsTable, jobsTable } from "@workspace/db";
import type { RecurringInvoiceTemplate } from "@workspace/db";
import { eq, and, lte, sql, inArray, notInArray, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { sendEmail } from "./emailProvider";

const MAX_EMAIL_ATTEMPTS = 3;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either an active transaction or the plain db handle — read helpers below accept both so previews can run outside a transaction. */
type Queryable = Tx | typeof db;

type BillingLineItem = { description: string; quantity: number; unitPrice: number; total: number };

// ── Atomic claim guard ───────────────────────────────────────────────────────

/**
 * Atomically claims a set of jobs for invoicing by setting a sentinel invoiceId of -1.
 * Only rows whose invoiceId IS NULL are updated, so a concurrent process that races
 * to claim the same job will get rowCount = 0 for that row and skip it.
 *
 * Must be called inside a transaction: the sentinel value (-1) is replaced by the real
 * invoiceId before the transaction commits, so it is never visible to external readers.
 * If the transaction rolls back, the UPDATE rolls back too and the job stays claimable.
 *
 * Returns the subset of jobIds that were successfully claimed by this call.
 */
async function claimJobsForInvoicing(tx: Tx, jobIds: number[]): Promise<number[]> {
  if (jobIds.length === 0) return [];
  const claimed = await tx
    .update(jobsTable)
    .set({ invoiceId: -1 })
    .where(and(inArray(jobsTable.id, jobIds), isNull(jobsTable.invoiceId)))
    .returning({ id: jobsTable.id });
  return claimed.map(r => r.id);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayDateString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10); // "yyyy-mm-dd"
}

function addDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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

function addBiMonth(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
}

/** Exported for unit testing of calendar edge-case advancement (month-end, leap year, year boundary). */
export function nextBillingDate(current: string, cycleType: string): string {
  if (cycleType === "daily") return addDay(current);
  if (cycleType === "weekly") return addWeek(current);
  if (cycleType === "bi_monthly") return addBiMonth(current);
  return addMonth(current);
}

function generateInvoiceNumber(): string {
  return `INV-${Date.now().toString().slice(-8)}`;
}

/**
 * Builds invoice line items for a 'completed_work' template from a specific customer's
 * jobs completed since the template's last billing run (or since it was created, if it
 * has never run). Matching jobs are constrained to the template's serviceId when set.
 * Only jobs not already tied to another invoice are eligible, so work is never double-billed.
 */
async function collectCompletedWorkForCustomer(
  tx: Queryable,
  tenantId: number,
  customerId: number,
  serviceId: number | null,
  periodStart: Date,
  periodEnd: Date,
  excludeJobIds: number[] = [],
): Promise<{ lineItems: BillingLineItem[]; jobIds: number[] }> {
  const jobs = await tx
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.customerId, customerId),
        eq(jobsTable.status, "completed"),
        sql`${jobsTable.completedAt} IS NOT NULL`,
        sql`${jobsTable.completedAt} > ${periodStart}`,
        sql`${jobsTable.completedAt} <= ${periodEnd}`,
        sql`${jobsTable.invoiceId} IS NULL`,
        serviceId != null ? eq(jobsTable.serviceId, serviceId) : sql`true`,
        excludeJobIds.length > 0 ? notInArray(jobsTable.id, excludeJobIds) : sql`true`,
      ),
    );

  const lineItems: BillingLineItem[] = jobs.map(job => ({
    description: job.title,
    quantity: 1,
    unitPrice: job.totalAmount,
    total: job.totalAmount,
  }));

  return { lineItems, jobIds: jobs.map(j => j.id) };
}

/** Distinct customers with qualifying completed work for a service-only-scoped template (no customerId set). */
async function findCustomersWithCompletedWork(
  tx: Queryable,
  tenantId: number,
  serviceId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<number[]> {
  const rows = await tx
    .selectDistinct({ customerId: jobsTable.customerId })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.serviceId, serviceId),
        eq(jobsTable.status, "completed"),
        sql`${jobsTable.completedAt} IS NOT NULL`,
        sql`${jobsTable.completedAt} > ${periodStart}`,
        sql`${jobsTable.completedAt} <= ${periodEnd}`,
        sql`${jobsTable.invoiceId} IS NULL`,
        sql`${jobsTable.customerId} IS NOT NULL`,
      ),
    );
  return rows.map(r => r.customerId).filter((id): id is number => id != null);
}

/**
 * Generates a single invoice for one customer under the given template, using either the
 * template's static line items or completed-work line items depending on billingMode.
 * Returns null if there was nothing to bill (only possible in 'completed_work' mode).
 *
 * For 'completed_work' mode, an atomic claim guard (claimJobsForInvoicing) locks each
 * eligible job row before the invoice is created, preventing a concurrent scheduler run
 * from picking up the same jobs and generating a duplicate invoice.
 */
async function generateInvoiceForCustomer(
  tx: Tx,
  template: RecurringInvoiceTemplate,
  customerId: number,
  taxRate: number,
  periodStart: Date,
  periodEnd: Date,
  excludeJobIds: number[] = [],
  billingDate?: string,
): Promise<number | null> {
  // ── Per-customer idempotency check ───────────────────────────────────────
  // When billingDate is set (scheduler runs only; manual runTemplateNow omits it),
  // verify no invoice for this exact (template, customer, billingDate) tuple exists.
  // This lets a partial run—where the server crashed after billing some customers
  // but before advancing nextBillingDate—safely resume: already-billed customers
  // are skipped individually while remaining ones are processed normally.
  // The DB unique index on (generated_from_template_id, customer_id, billing_date)
  // provides the final hard stop for any race that slips past this check.
  if (billingDate != null) {
    const [existing] = await tx
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.generatedFromTemplateId, template.id),
          eq(invoicesTable.customerId, customerId),
          eq(invoicesTable.billingDate, billingDate),
        ),
      )
      .limit(1);

    if (existing) {
      logger.info(
        { templateId: template.id, customerId, billingDate, existingInvoiceId: existing.id },
        "Invoice already generated for this template+customer+date; skipping duplicate",
      );
      return null;
    }
  }
  // ── End per-customer idempotency check ───────────────────────────────────

  let lineItems: BillingLineItem[];
  let jobIds: number[] = [];

  if (template.billingMode === "completed_work") {
    const result = await collectCompletedWorkForCustomer(tx, template.tenantId, customerId, template.serviceId, periodStart, periodEnd, excludeJobIds);
    if (result.lineItems.length === 0) return null;

    // Atomically claim the found jobs. A concurrent process racing the same
    // period will get an empty claim set for any row we've already locked.
    const claimedIds = new Set(await claimJobsForInvoicing(tx, result.jobIds));
    // Keep only the line items whose jobs we actually claimed.
    const filtered = result.jobIds.reduce<{ lineItems: BillingLineItem[]; jobIds: number[] }>(
      (acc, id, i) => {
        if (claimedIds.has(id)) {
          acc.lineItems.push(result.lineItems[i]);
          acc.jobIds.push(id);
        }
        return acc;
      },
      { lineItems: [], jobIds: [] },
    );

    if (filtered.lineItems.length === 0) return null;
    lineItems = filtered.lineItems;
    jobIds = filtered.jobIds;
  } else {
    lineItems = (template.lineItems as BillingLineItem[]) ?? [];
  }

  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  const invoiceNum = generateInvoiceNumber();

  const [invoice] = await tx
    .insert(invoicesTable)
    .values({
      tenantId: template.tenantId,
      invoiceNumber: invoiceNum,
      customerId,
      status: "sent",
      subtotal,
      tax,
      total,
      lineItems,
      notes: template.notes ?? null,
      generatedFromTemplateId: template.id,
      billingDate: billingDate ?? null,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // net-30
    })
    .returning();

  if (jobIds.length > 0) {
    await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(inArray(jobsTable.id, jobIds));
  }

  await tx.insert(billingEmailQueueTable).values({
    tenantId: template.tenantId,
    invoiceId: invoice.id,
    status: "pending",
    attempts: 0,
  });

  return invoice.id;
}

/** Runs one due template inside a transaction: generates 1..N invoices (N>1 only for service-only scope) and advances the schedule. */
async function generateDueTemplate(tx: Tx, template: RecurringInvoiceTemplate): Promise<number[]> {
  // ── Concurrent-process guard ─────────────────────────────────────────────
  // Lock the template row so that if two scheduler processes start at the same
  // moment only one proceeds at a time. After acquiring the lock, re-read
  // nextBillingDate: if another process already advanced it past today while we
  // were waiting, bail out immediately — the work is done.
  const [locked] = await tx
    .select({
      id: recurringInvoiceTemplatesTable.id,
      nextBillingDate: recurringInvoiceTemplatesTable.nextBillingDate,
    })
    .from(recurringInvoiceTemplatesTable)
    .where(eq(recurringInvoiceTemplatesTable.id, template.id))
    .for("update");

  if (!locked) return []; // row was deleted between the outer SELECT and the lock

  const today = todayDateString();
  if (locked.nextBillingDate > today) {
    // Another process already advanced the schedule while we were waiting.
    logger.info({ templateId: template.id }, "Recurring template already processed by concurrent run; skipping");
    return [];
  }
  // ── End concurrent-process guard ─────────────────────────────────────────

  const [tenant] = await tx
    .select({ taxRate: tenantsTable.taxRate })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, template.tenantId));
  const taxRate = tenant?.taxRate ?? 0;

  const periodStart = template.lastGeneratedAt ?? template.createdAt;
  const periodEnd = new Date();

  const invoiceIds: number[] = [];

  if (template.customerId != null) {
    // Per-customer idempotency is handled inside generateInvoiceForCustomer using billingDate.
    const invoiceId = await generateInvoiceForCustomer(tx, template, template.customerId, taxRate, periodStart, periodEnd, [], today);
    if (invoiceId != null) invoiceIds.push(invoiceId);
  } else if (template.serviceId != null) {
    // Service-only scope: bill every customer who has qualifying completed work this period.
    // Each customer is checked individually so a partial prior run can continue
    // billing remaining customers without re-billing those already invoiced.
    const customerIds = await findCustomersWithCompletedWork(tx, template.tenantId, template.serviceId, periodStart, periodEnd);
    for (const customerId of customerIds) {
      const invoiceId = await generateInvoiceForCustomer(tx, template, customerId, taxRate, periodStart, periodEnd, [], today);
      if (invoiceId != null) invoiceIds.push(invoiceId);
    }
  }

  const nextDate = nextBillingDate(template.nextBillingDate, template.billingCycleType);
  await tx
    .update(recurringInvoiceTemplatesTable)
    .set({ nextBillingDate: nextDate, lastGeneratedAt: periodEnd })
    .where(eq(recurringInvoiceTemplatesTable.id, template.id));

  return invoiceIds;
}

// ── 1. Process recurring templates ───────────────────────────────────────────

async function processRecurringTemplates() {
  const today = todayDateString();

  const templates = await db
    .select()
    .from(recurringInvoiceTemplatesTable)
    .where(
      and(
        eq(recurringInvoiceTemplatesTable.isActive, true),
        lte(recurringInvoiceTemplatesTable.nextBillingDate, today),
      ),
    );

  let generated = 0;

  for (const template of templates) {
    try {
      await db.transaction(async tx => {
        const invoiceIds = await generateDueTemplate(tx, template);
        generated += invoiceIds.length;
        if (invoiceIds.length > 0) {
          logger.info({ templateId: template.id, invoiceIds, customerId: template.customerId }, "Generated recurring invoice(s)");
        } else {
          logger.info({ templateId: template.id }, "Recurring template due but had nothing to bill; schedule advanced");
        }
      });
    } catch (err) {
      logger.error({ err, templateId: template.id }, "Failed to generate recurring invoice");
    }
  }

  if (generated > 0) {
    logger.info({ generated }, "Billing scheduler: generated recurring invoices");
  }
}

// ── 1b. Weekly batch for completed non-recurring jobs flagged pendingWeeklyInvoice ──

async function processWeeklyNonRecurringInvoices() {
  // Batch runs once a week (Mondays); jobs accumulate the pendingWeeklyInvoice flag
  // between runs and are all invoiced together on the weekly sweep.
  if (new Date().getUTCDay() !== 1) return;

  const flaggedJobs = await db
    .select({ job: jobsTable, customerEmail: customersTable.email, customerName: customersTable.name })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .where(and(eq(jobsTable.pendingWeeklyInvoice, true), sql`${jobsTable.invoiceId} IS NULL`));

  let generated = 0;

  for (const { job, customerEmail } of flaggedJobs) {
    if (!job.customerId) continue;
    try {
      const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, job.tenantId));
      const taxRate = tenant?.taxRate ?? 0;
      const lineItems = (job.lineItems as unknown[]) ?? [];
      const subtotal = job.totalAmount ?? 0;
      const tax = subtotal * (taxRate / 100);
      const total = subtotal + tax;
      const invoiceNum = generateInvoiceNumber();

      let invoiceId!: number;
      let claimed = false;
      await db.transaction(async tx => {
        // Atomically claim this job before creating the invoice. If another
        // concurrent process already claimed it (invoiceId != null), bail out.
        const [claimedRow] = await tx
          .update(jobsTable)
          .set({ invoiceId: -1 })
          .where(and(eq(jobsTable.id, job.id), isNull(jobsTable.invoiceId)))
          .returning({ id: jobsTable.id });
        if (!claimedRow) return; // Already claimed — skip silently

        const [invoice] = await tx.insert(invoicesTable).values({
          tenantId: job.tenantId,
          invoiceNumber: invoiceNum,
          customerId: job.customerId!,
          jobId: job.id,
          status: customerEmail ? "sent" : "draft",
          subtotal,
          tax,
          total,
          lineItems,
        }).returning();
        invoiceId = invoice.id;
        await tx.update(jobsTable).set({ invoiceId: invoice.id, pendingWeeklyInvoice: false }).where(eq(jobsTable.id, job.id));
        claimed = true;
      });
      if (!claimed) continue;

      if (customerEmail) await enqueueInvoiceEmail(job.tenantId, invoiceId);
      generated++;
      logger.info({ jobId: job.id, invoiceId }, "Generated weekly batch invoice for completed job");
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to generate weekly batch invoice");
    }
  }

  if (generated > 0) {
    logger.info({ generated }, "Billing scheduler: generated weekly non-recurring invoices");
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
  await processWeeklyNonRecurringInvoices();
  await processEmailQueue();
  logger.info("Billing scheduler: daily cycle complete");
}

/**
 * Dev/Test Panel: preview which of a tenant's active recurring templates are due
 * to run today or earlier (mirrors the criteria the hourly scheduler uses), without
 * generating anything.
 */
export async function previewDueTemplates(tenantId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const due = await db
    .select({ template: recurringInvoiceTemplatesTable, customerName: customersTable.name })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .where(and(
      eq(recurringInvoiceTemplatesTable.tenantId, tenantId),
      eq(recurringInvoiceTemplatesTable.isActive, true),
      sql`${recurringInvoiceTemplatesTable.nextBillingDate} <= ${today}`,
    ));

  return due.map(({ template, customerName }) => {
    const lineItems = (template.lineItems as Array<{ quantity: number; unitPrice: number }>) ?? [];
    const subtotal = template.billingMode === "completed_work" ? null : lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
    return {
      templateId: template.id,
      templateName: template.name,
      customerName: customerName ?? (template.serviceId != null ? "Multiple (per completed work)" : "Unknown"),
      nextBillingDate: template.nextBillingDate,
      estimatedAmount: subtotal,
    };
  });
}

/** Dev/Test Panel: actually runs every due template for this tenant right now (same code path as the per-template "run now" button). */
export async function runAllDueTemplatesNow(tenantId: number) {
  const due = await previewDueTemplates(tenantId);
  const results: Array<{ templateId: number; templateName: string; success: boolean; invoiceId?: number; error?: string }> = [];
  for (const item of due) {
    try {
      const result = await runTemplateNow(item.templateId, tenantId);
      results.push({ templateId: item.templateId, templateName: item.templateName, success: true, invoiceId: result.invoiceId ?? undefined });
    } catch (err) {
      results.push({ templateId: item.templateId, templateName: item.templateName, success: false, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return results;
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

/**
 * Manually trigger a single recurring template. Used by the "Generate Now" API. Does not advance nextBillingDate.
 * `excludeJobIds` lets staff drop specific completed jobs from this run (surfaced via the "Preview" action);
 * only meaningful for 'completed_work' templates.
 */
export async function runTemplateNow(templateId: number, tenantId: number, excludeJobIds: number[] = []): Promise<{ invoiceId: number | null; invoiceIds: number[] }> {
  const [template] = await db
    .select()
    .from(recurringInvoiceTemplatesTable)
    .where(
      and(
        eq(recurringInvoiceTemplatesTable.id, templateId),
        eq(recurringInvoiceTemplatesTable.tenantId, tenantId),
      ),
    );

  if (!template) throw new Error("Template not found");

  const [tenant] = await db
    .select({ taxRate: tenantsTable.taxRate })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const taxRate = tenant?.taxRate ?? 0;

  const periodStart = template.lastGeneratedAt ?? template.createdAt;
  const periodEnd = new Date();

  const invoiceIds: number[] = [];

  await db.transaction(async tx => {
    if (template.customerId != null) {
      const invoiceId = await generateInvoiceForCustomer(tx, template, template.customerId, taxRate, periodStart, periodEnd, excludeJobIds);
      if (invoiceId != null) invoiceIds.push(invoiceId);
    } else if (template.serviceId != null) {
      const customerIds = await findCustomersWithCompletedWork(tx, template.tenantId, template.serviceId, periodStart, periodEnd);
      for (const customerId of customerIds) {
        const invoiceId = await generateInvoiceForCustomer(tx, template, customerId, taxRate, periodStart, periodEnd, excludeJobIds);
        if (invoiceId != null) invoiceIds.push(invoiceId);
      }
    }

    if (invoiceIds.length > 0) {
      await tx
        .update(recurringInvoiceTemplatesTable)
        .set({ lastGeneratedAt: periodEnd })
        .where(eq(recurringInvoiceTemplatesTable.id, template.id));
    }
  });

  if (invoiceIds.length === 0) {
    throw new Error(
      template.billingMode === "completed_work"
        ? "No completed work found to bill for this period"
        : "Nothing to bill",
    );
  }

  // Process email queue immediately for these invoices
  await processEmailQueue();

  return { invoiceId: invoiceIds[0], invoiceIds };
}

/**
 * Preview which completed jobs a 'completed_work' template would bill if run right now, grouped by customer,
 * without generating anything or mutating jobs/invoices. Surfaces per-job detail so staff can exclude a
 * miscategorized or duplicate job (via runTemplateNow's excludeJobIds) before triggering the real run.
 * For 'static' templates (nothing job-based to preview) this returns an empty group list.
 */
export async function previewTemplateBilling(templateId: number, tenantId: number) {
  const [template] = await db
    .select()
    .from(recurringInvoiceTemplatesTable)
    .where(
      and(
        eq(recurringInvoiceTemplatesTable.id, templateId),
        eq(recurringInvoiceTemplatesTable.tenantId, tenantId),
      ),
    );

  if (!template) throw new Error("Template not found");

  if (template.billingMode !== "completed_work") {
    return { templateId: template.id, templateName: template.name, billingMode: template.billingMode, periodStart: null, periodEnd: null, groups: [], total: 0 };
  }

  const periodStart = template.lastGeneratedAt ?? template.createdAt;
  const periodEnd = new Date();

  const customerIds: number[] = template.customerId != null
    ? [template.customerId]
    : template.serviceId != null
      ? await findCustomersWithCompletedWork(db, template.tenantId, template.serviceId, periodStart, periodEnd)
      : [];

  const groups: Array<{ customerId: number; customerName: string; jobs: Array<{ id: number; title: string; completedAt: string; totalAmount: number; serviceId: number | null }>; subtotal: number }> = [];

  for (const customerId of customerIds) {
    const jobs = await db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.customerId, customerId),
          eq(jobsTable.status, "completed"),
          sql`${jobsTable.completedAt} IS NOT NULL`,
          sql`${jobsTable.completedAt} > ${periodStart}`,
          sql`${jobsTable.completedAt} <= ${periodEnd}`,
          sql`${jobsTable.invoiceId} IS NULL`,
          template.serviceId != null ? eq(jobsTable.serviceId, template.serviceId) : sql`true`,
        ),
      );

    if (jobs.length === 0) continue;

    const [customer] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId));

    groups.push({
      customerId,
      customerName: customer?.name ?? "Unknown",
      jobs: jobs.map(j => ({
        id: j.id,
        title: j.title,
        completedAt: j.completedAt!.toISOString(),
        totalAmount: j.totalAmount,
        serviceId: j.serviceId,
      })),
      subtotal: jobs.reduce((sum, j) => sum + j.totalAmount, 0),
    });
  }

  const total = groups.reduce((sum, g) => sum + g.subtotal, 0);

  return {
    templateId: template.id,
    templateName: template.name,
    billingMode: template.billingMode,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    groups,
    total,
  };
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
