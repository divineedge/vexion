/**
 * Dev/Test Panel (Settings → Advanced, owner-only).
 * Lets an owner dry-run or execute the automation jobs that normally only run on
 * a timer, with a live result log. In production, executing (not previewing) any
 * simulation requires an explicit confirmation flag from the client.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, jobsTable, customersTable, tenantsTable, invoicesTable, activityLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isOwnerRole } from "../lib/roles";
import { previewDueTemplates, runAllDueTemplatesNow } from "../lib/billingScheduler";
import { previewWeeklyReminders, runWeeklyRemindersNow } from "../lib/reminderScheduler";
import { previewRecurrenceForTenant, runRecurrenceForTenantNow } from "../lib/recurrenceScheduler";

const router: IRouter = Router();

const isProduction = process.env.NODE_ENV === "production";

async function requireOwner(req: Request, res: Response): Promise<{ tenantId: number; userId: number } | null> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isOwnerRole(tenantId, userId))) {
    res.status(403).json({ error: "The Dev/Test Panel is restricted to the company owner" });
    return null;
  }
  return { tenantId, userId };
}

/** Blocks a live "execute" action in production unless the client explicitly confirmed it. */
function checkProductionGate(req: Request, res: Response): boolean {
  if (isProduction && !req.body?.confirmProductionRun) {
    res.status(400).json({ error: "This action affects live data. Re-run with confirmProductionRun: true to proceed in production." });
    return false;
  }
  return true;
}

router.get("/dev-tools/environment", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;
  res.json({ isProduction, environment: process.env.NODE_ENV ?? "development" });
});

// ── Generate Monthly Invoices Now ───────────────────────────────────────────

router.post("/dev-tools/simulate/generate-invoices", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;

  const { dryRun = true } = req.body as { dryRun?: boolean };
  if (dryRun) {
    const due = await previewDueTemplates(ctx.tenantId);
    res.json({ dryRun: true, due });
    return;
  }
  if (!checkProductionGate(req, res)) return;

  const results = await runAllDueTemplatesNow(ctx.tenantId);
  res.json({ dryRun: false, results });
});

// ── Send 7-Day Reminders for This Week's Jobs ───────────────────────────────

router.post("/dev-tools/simulate/send-reminders", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;

  const { dryRun = true } = req.body as { dryRun?: boolean };
  if (dryRun) {
    const preview = await previewWeeklyReminders(ctx.tenantId);
    res.json({ dryRun: true, jobs: preview });
    return;
  }
  if (!checkProductionGate(req, res)) return;

  const results = await runWeeklyRemindersNow(ctx.tenantId);
  res.json({ dryRun: false, results });
});

// ── Trigger Job Completion Auto-Invoice ─────────────────────────────────────

router.get("/dev-tools/simulate/completable-jobs", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;

  const rows = await db
    .select({ job: jobsTable, customerName: customersTable.name, autoInvoiceOnCompletion: customersTable.autoInvoiceOnCompletion })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .where(and(eq(jobsTable.tenantId, ctx.tenantId), eq(jobsTable.status, "in_progress")));

  res.json(rows.map(r => ({
    jobId: r.job.id,
    title: r.job.title,
    customerName: r.customerName ?? "Unknown",
    totalAmount: r.job.totalAmount ?? 0,
    wouldAutoInvoice: !!r.autoInvoiceOnCompletion && !r.job.invoiceId,
  })));
});

router.post("/dev-tools/simulate/complete-job-auto-invoice", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;

  const { jobId, dryRun = true } = req.body as { jobId: number; dryRun?: boolean };
  if (!jobId) { res.status(400).json({ error: "jobId is required" }); return; }

  const [row] = await db
    .select({ job: jobsTable, customer: customersTable })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, ctx.tenantId)));
  if (!row) { res.status(404).json({ error: "Job not found" }); return; }

  if (dryRun) {
    const wouldInvoice = !!row.customer?.autoInvoiceOnCompletion && !row.job.invoiceId;
    res.json({
      dryRun: true,
      jobId, title: row.job.title, currentStatus: row.job.status,
      wouldAutoInvoice: wouldInvoice,
      estimatedAmount: row.job.totalAmount ?? 0,
    });
    return;
  }
  if (!checkProductionGate(req, res)) return;

  const [updated] = await db.update(jobsTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, ctx.tenantId)))
    .returning();

  await db.insert(activityLogTable).values({ tenantId: ctx.tenantId, userId: ctx.userId, type: "job_completed", message: `Job "${updated.title}" completed (Dev/Test Panel simulation)`, entityId: jobId });

  let invoiceId: number | undefined;
  if (row.customer?.autoInvoiceOnCompletion && !updated.invoiceId) {
    const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, ctx.tenantId));
    const taxRate = tenant?.taxRate ?? 0;
    const subtotal = updated.totalAmount ?? 0;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

    await db.transaction(async tx => {
      const [invoice] = await tx.insert(invoicesTable).values({
        tenantId: ctx.tenantId,
        invoiceNumber: invoiceNum,
        customerId: updated.customerId!,
        jobId: updated.id,
        status: row.customer!.email ? "sent" : "draft",
        publicToken: row.customer!.email ? crypto.randomBytes(32).toString("hex") : null,
        subtotal, tax, total,
        lineItems: (updated.lineItems as unknown[]) ?? [],
      }).returning();
      invoiceId = invoice.id;
      await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, jobId));
    });
  }

  res.json({ dryRun: false, jobId, invoiceGenerated: !!invoiceId, invoiceId });
});

// ── Run Recurring Job Scheduler ─────────────────────────────────────────────

router.post("/dev-tools/simulate/run-recurring-scheduler", async (req, res): Promise<void> => {
  const ctx = await requireOwner(req, res);
  if (!ctx) return;

  const { dryRun = true } = req.body as { dryRun?: boolean };
  if (dryRun) {
    const preview = await previewRecurrenceForTenant(ctx.tenantId);
    res.json({ dryRun: true, series: preview });
    return;
  }
  if (!checkProductionGate(req, res)) return;

  const results = await runRecurrenceForTenantNow(ctx.tenantId);
  res.json({ dryRun: false, results });
});

export default router;
