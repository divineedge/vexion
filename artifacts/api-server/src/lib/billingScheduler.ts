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
import { eq, and, lte, sql, inArray, notInArray, isNull, asc, min, lt, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import { sendEmail } from "./emailProvider";
import crypto from "crypto";

function generatePublicToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const MAX_EMAIL_ATTEMPTS = 3;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either an active transaction or the plain db handle — read helpers below accept both so previews can run outside a transaction. */
type Queryable = Tx | typeof db;

type BillingLineItem = { description: string; quantity: number; unitPrice: number; total: number };

// ── Atomic claim guard ───────────────────────────────────────────────────────

/**
 * Atomically claims a set of jobs for invoicing by stamping `invoiceClaimLockAt`
 * with the current timestamp.  Only rows whose invoiceId IS NULL *and*
 * invoiceClaimLockAt IS NULL are updated, so a concurrent process that races to
 * claim the same job will see rowCount = 0 for that row and skip it.
 *
 * Must be called inside a transaction.  The lock column is cleared once the real
 * invoiceId is written into the same transaction.  If the transaction rolls back the
 * UPDATE rolls back too and the job stays claimable.  If the process crashes before
 * the commit, the stale-lock cleanup sweep (resetStaleClaimLocks) will clear the
 * column after ~5 minutes so the job re-enters the eligible pool.
 *
 * Returns the subset of jobIds that were successfully claimed by this call.
 */
async function claimJobsForInvoicing(tx: Tx, jobIds: number[]): Promise<number[]> {
  if (jobIds.length === 0) return [];
  const now = new Date();
  const claimed = await tx
    .update(jobsTable)
    .set({ invoiceClaimLockAt: now })
    .where(
      and(
        inArray(jobsTable.id, jobIds),
        isNull(jobsTable.invoiceId),
        isNull(jobsTable.invoiceClaimLockAt),
      ),
    )
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
/**
 * @param excludeHeld  When true (nightly scheduler default) jobs with holdFromBilling=true
 *                     are silently skipped. Pass false for manual "Generate Now" runs so that
 *                     staff-controlled excludeJobIds remain the only gate — a held job that
 *                     staff explicitly leave checked in the preview should still be billed.
 */
async function collectCompletedWorkForCustomer(
  tx: Queryable,
  tenantId: number,
  customerId: number,
  serviceId: number | null,
  periodStart: Date,
  periodEnd: Date,
  excludeJobIds: number[] = [],
  excludeHeld = true,
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
        excludeHeld ? eq(jobsTable.holdFromBilling, false) : sql`true`,
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

/**
 * Distinct customers with qualifying completed work for a service-only-scoped template.
 * @param excludeHeld  When true (default, used by the nightly run) customers whose only
 *                     qualifying jobs are on hold are omitted. Pass false for the preview
 *                     so staff can see and toggle held jobs before the run.
 */
async function findCustomersWithCompletedWork(
  tx: Queryable,
  tenantId: number,
  serviceId: number,
  periodStart: Date,
  periodEnd: Date,
  excludeHeld = true,
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
        // Skip customers whose only qualifying jobs are on hold (nightly run only).
        excludeHeld ? eq(jobsTable.holdFromBilling, false) : sql`true`,
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
  excludeHeld = true,
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
    const result = await collectCompletedWorkForCustomer(tx, template.tenantId, customerId, template.serviceId, periodStart, periodEnd, excludeJobIds, excludeHeld);
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
      publicToken: generatePublicToken(),
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
    // Write the real invoiceId and clear the claim lock.  Also clear holdFromBilling
    // now that the job has actually been billed — the hold was a "skip me in the
    // *next* run" signal, not a permanent exclusion.
    await tx
      .update(jobsTable)
      .set({ invoiceId: invoice.id, invoiceClaimLockAt: null, holdFromBilling: false })
      .where(inArray(jobsTable.id, jobIds));
  }

  await tx.insert(billingEmailQueueTable).values({
    tenantId: template.tenantId,
    invoiceId: invoice.id,
    status: "pending",
    attempts: 0,
  });

  return invoice.id;
}

/**
 * Runs one due template inside a transaction: generates 1..N invoices (N>1 only for service-only scope) and advances the schedule.
 * Exported for integration testing only — call via db.transaction() in production.
 */
export async function generateDueTemplate(tx: Tx, template: RecurringInvoiceTemplate): Promise<number[]> {
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
    // excludeHeld=true: the nightly run respects the per-job hold flag set by staff.
    const invoiceId = await generateInvoiceForCustomer(tx, template, template.customerId, taxRate, periodStart, periodEnd, [], today, true);
    if (invoiceId != null) invoiceIds.push(invoiceId);
  } else if (template.serviceId != null) {
    // Service-only scope: bill every customer who has qualifying completed work this period.
    // Each customer is checked individually so a partial prior run can continue
    // billing remaining customers without re-billing those already invoiced.
    // excludeHeld=true in both calls so held jobs are skipped during the unattended run.
    const customerIds = await findCustomersWithCompletedWork(tx, template.tenantId, template.serviceId, periodStart, periodEnd, true);
    for (const customerId of customerIds) {
      const invoiceId = await generateInvoiceForCustomer(tx, template, customerId, taxRate, periodStart, periodEnd, [], today, true);
      if (invoiceId != null) invoiceIds.push(invoiceId);
    }
  }

  // ── Cap lastGeneratedAt to avoid permanently losing held jobs ────────────
  // If any jobs in this period are held, advancing lastGeneratedAt all the way
  // to periodEnd would push them outside the next run's window (completedAt >
  // lastGeneratedAt).  Find the earliest held+unbilled job's completedAt and
  // cap the advancement to 1 ms before it, so the job re-enters the window
  // once its hold is released.
  const [earliestHeld] = await tx
    .select({ completedAt: min(jobsTable.completedAt) })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.tenantId, template.tenantId),
        eq(jobsTable.status, "completed"),
        eq(jobsTable.holdFromBilling, true),
        isNull(jobsTable.invoiceId),
        sql`${jobsTable.completedAt} IS NOT NULL`,
        sql`${jobsTable.completedAt} > ${periodStart}`,
        sql`${jobsTable.completedAt} <= ${periodEnd}`,
        template.customerId != null ? eq(jobsTable.customerId, template.customerId) : sql`true`,
        template.serviceId != null ? eq(jobsTable.serviceId, template.serviceId) : sql`true`,
      ),
    );

  let effectiveLastGeneratedAt = periodEnd;
  if (earliestHeld?.completedAt != null) {
    const cap = new Date(earliestHeld.completedAt.getTime() - 1);
    if (cap < effectiveLastGeneratedAt) {
      effectiveLastGeneratedAt = cap;
      logger.info(
        { templateId: template.id, heldJobCompletedAt: earliestHeld.completedAt, cap },
        "Held job(s) found in period — capping lastGeneratedAt so they remain billable after release",
      );
    }
  }
  // ── End cap logic ─────────────────────────────────────────────────────────

  const nextDate = nextBillingDate(template.nextBillingDate, template.billingCycleType);
  await tx
    .update(recurringInvoiceTemplatesTable)
    .set({ nextBillingDate: nextDate, lastGeneratedAt: effectiveLastGeneratedAt })
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
        // concurrent process already claimed it (invoiceId != null or
        // invoiceClaimLockAt != null), bail out.
        const [claimedRow] = await tx
          .update(jobsTable)
          .set({ invoiceClaimLockAt: new Date() })
          .where(
            and(
              eq(jobsTable.id, job.id),
              isNull(jobsTable.invoiceId),
              isNull(jobsTable.invoiceClaimLockAt),
            ),
          )
          .returning({ id: jobsTable.id });
        if (!claimedRow) return; // Already claimed — skip silently

        const [invoice] = await tx.insert(invoicesTable).values({
          tenantId: job.tenantId,
          invoiceNumber: invoiceNum,
          customerId: job.customerId!,
          jobId: job.id,
          status: customerEmail ? "sent" : "draft",
          publicToken: customerEmail ? generatePublicToken() : null,
          subtotal,
          tax,
          total,
          lineItems,
        }).returning();
        invoiceId = invoice.id;
        // Write the real invoiceId and clear the claim lock in the same statement.
        await tx
          .update(jobsTable)
          .set({ invoiceId: invoice.id, invoiceClaimLockAt: null, pendingWeeklyInvoice: false })
          .where(eq(jobsTable.id, job.id));
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

// ── Stale claim-lock cleanup ──────────────────────────────────────────────────

/**
 * Resets `invoiceClaimLockAt` on any job where the lock is older than 5 minutes
 * and no real invoiceId was ever written.  This handles the case where the billing
 * process crashed mid-transaction before the commit: without this sweep those jobs
 * would remain locked indefinitely and never appear in a future billing run.
 */
async function resetStaleClaimLocks(): Promise<void> {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const reset = await db
    .update(jobsTable)
    .set({ invoiceClaimLockAt: null })
    .where(
      and(
        isNotNull(jobsTable.invoiceClaimLockAt),
        isNull(jobsTable.invoiceId),
        lt(jobsTable.invoiceClaimLockAt, cutoff),
      ),
    )
    .returning({ id: jobsTable.id });

  if (reset.length > 0) {
    logger.warn(
      { jobIds: reset.map(r => r.id), cutoff },
      "Billing scheduler: reset stale invoice claim locks (likely from a prior crashed process)",
    );
  }
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

async function runBillingCycle() {
  logger.info("Billing scheduler: starting daily cycle");
  // Clear any stale claim locks left by a previous crashed process before
  // attempting new invoice generation, so those jobs re-enter the eligible pool.
  await resetStaleClaimLocks();
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
      // excludeHeld=false: manual "Generate Now" respects only the staff-selected excludeJobIds;
      // a held job that staff leave checked in the preview should still be billed.
      const invoiceId = await generateInvoiceForCustomer(tx, template, template.customerId, taxRate, periodStart, periodEnd, excludeJobIds, undefined, false);
      if (invoiceId != null) invoiceIds.push(invoiceId);
    } else if (template.serviceId != null) {
      // excludeHeld=false so all customers with qualifying work appear; staff-selected excludeJobIds gate individual jobs.
      const customerIds = await findCustomersWithCompletedWork(tx, template.tenantId, template.serviceId, periodStart, periodEnd, false);
      for (const customerId of customerIds) {
        const invoiceId = await generateInvoiceForCustomer(tx, template, customerId, taxRate, periodStart, periodEnd, excludeJobIds, undefined, false);
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
      ? await findCustomersWithCompletedWork(db, template.tenantId, template.serviceId, periodStart, periodEnd, false)
      : [];

  const groups: Array<{ customerId: number; customerName: string; jobs: Array<{ id: number; title: string; completedAt: string; totalAmount: number; serviceId: number | null; holdFromBilling: boolean }>; subtotal: number }> = [];

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

    // ── Heuristic flags ─────────────────────────────────────────────────
    // Duplicate: two jobs in this group share the same serviceId and were
    // completed within 30 minutes of each other — likely the same work logged twice.
    const DUPLICATE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
    const duplicateJobIds = new Set<number>();
    for (let a = 0; a < jobs.length; a++) {
      for (let b = a + 1; b < jobs.length; b++) {
        const jobA = jobs[a];
        const jobB = jobs[b];
        if (
          jobA.serviceId != null &&
          jobA.serviceId === jobB.serviceId &&
          Math.abs(jobA.completedAt!.getTime() - jobB.completedAt!.getTime()) <= DUPLICATE_WINDOW_MS
        ) {
          duplicateJobIds.add(jobA.id);
          duplicateJobIds.add(jobB.id);
        }
      }
    }

    // Outlier: job amount is >2.5 std deviations from the group mean.
    // Only applied when the group has ≥3 jobs (fewer jobs don't give a meaningful baseline).
    const outlierJobIds = new Set<number>();
    if (jobs.length >= 3) {
      const amounts = jobs.map(j => j.totalAmount);
      const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        for (const j of jobs) {
          if (Math.abs(j.totalAmount - mean) > 2.5 * stdDev) {
            outlierJobIds.add(j.id);
          }
        }
      }
    }

    groups.push({
      customerId,
      customerName: customer?.name ?? "Unknown",
      jobs: jobs.map(j => ({
        id: j.id,
        title: j.title,
        completedAt: j.completedAt!.toISOString(),
        totalAmount: j.totalAmount,
        serviceId: j.serviceId,
        flags: {
          duplicate: duplicateJobIds.has(j.id) || undefined,
          outlier: outlierJobIds.has(j.id) || undefined,
        },
        holdFromBilling: j.holdFromBilling,
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
