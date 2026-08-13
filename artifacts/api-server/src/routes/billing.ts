import { Router, type IRouter } from "express";
import { db, recurringInvoiceTemplatesTable, billingEmailQueueTable, invoicesTable, customersTable, servicesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { runTemplateNow, previewTemplateBilling } from "../lib/billingScheduler";

const router: IRouter = Router();

const BILLING_CYCLE_TYPES = new Set(["daily", "weekly", "monthly", "bi_monthly"]);
const BILLING_MODES = new Set(["static", "completed_work"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTemplate(t: typeof recurringInvoiceTemplatesTable.$inferSelect, customerName?: string | null, serviceName?: string | null) {
  return {
    ...t,
    lineItems: (t.lineItems as unknown[]) ?? [],
    lastGeneratedAt: t.lastGeneratedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    customerName: customerName ?? null,
    serviceName: serviceName ?? null,
  };
}

function formatQueueEntry(q: typeof billingEmailQueueTable.$inferSelect, invoiceNumber?: string | null) {
  return {
    ...q,
    lastAttemptAt: q.lastAttemptAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    invoiceNumber: invoiceNumber ?? null,
  };
}

// ── Recurring Templates CRUD ──────────────────────────────────────────────────

router.get("/billing/recurring-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({
      template: recurringInvoiceTemplatesTable,
      customerName: customersTable.name,
      serviceName: servicesTable.name,
    })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .leftJoin(servicesTable, eq(recurringInvoiceTemplatesTable.serviceId, servicesTable.id))
    .where(eq(recurringInvoiceTemplatesTable.tenantId, tenantId))
    .orderBy(desc(recurringInvoiceTemplatesTable.createdAt));

  res.json(rows.map(r => formatTemplate(r.template, r.customerName, r.serviceName)));
});

router.post("/billing/recurring-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const {
    customerId, serviceId, name, lineItems = [], billingMode = "static",
    billingCycleDay = 1, billingCycleType = "monthly", nextBillingDate, isActive = true, notes,
  } = req.body;

  if (!name || !nextBillingDate) {
    res.status(400).json({ error: "name and nextBillingDate are required" });
    return;
  }
  if (!customerId && !serviceId) {
    res.status(400).json({ error: "At least one of customerId or serviceId is required" });
    return;
  }
  if (!BILLING_CYCLE_TYPES.has(billingCycleType)) {
    res.status(400).json({ error: `billingCycleType must be one of ${[...BILLING_CYCLE_TYPES].join(", ")}` });
    return;
  }
  if (!BILLING_MODES.has(billingMode)) {
    res.status(400).json({ error: `billingMode must be one of ${[...BILLING_MODES].join(", ")}` });
    return;
  }
  if (billingMode === "static" && !customerId) {
    res.status(400).json({ error: "Static line-item templates require a customer" });
    return;
  }

  // For monthly templates, enforce that nextBillingDate day-of-month matches billingCycleDay
  if (billingCycleType === "monthly") {
    const day = Number(billingCycleDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      res.status(400).json({ error: "billingCycleDay must be 1–28 for monthly templates" });
      return;
    }
    const dateDayOfMonth = parseInt((nextBillingDate as string).split("-")[2] ?? "0", 10);
    if (dateDayOfMonth !== day) {
      res.status(400).json({ error: `nextBillingDate day-of-month (${dateDayOfMonth}) must match billingCycleDay (${day})` });
      return;
    }
  }

  const parsedCustomerId = customerId != null ? parseInt(customerId, 10) : null;
  const parsedServiceId = serviceId != null ? parseInt(serviceId, 10) : null;

  if (parsedCustomerId != null) {
    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, parsedCustomerId), eq(customersTable.tenantId, tenantId)));
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  }
  if (parsedServiceId != null) {
    const [service] = await db
      .select({ id: servicesTable.id })
      .from(servicesTable)
      .where(and(eq(servicesTable.id, parsedServiceId), eq(servicesTable.tenantId, tenantId)));
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  }

  const [template] = await db
    .insert(recurringInvoiceTemplatesTable)
    .values({
      tenantId,
      customerId: parsedCustomerId,
      serviceId: parsedServiceId,
      name,
      lineItems,
      billingMode,
      billingCycleDay,
      billingCycleType,
      nextBillingDate,
      isActive,
      notes: notes ?? null,
    })
    .returning();

  const [row] = template.customerId
    ? await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, template.customerId))
    : [undefined];
  const [serviceRow] = template.serviceId
    ? await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.id, template.serviceId))
    : [undefined];

  res.status(201).json(formatTemplate(template, row?.name, serviceRow?.name));
});

router.get("/billing/recurring-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({
      template: recurringInvoiceTemplatesTable,
      customerName: customersTable.name,
      serviceName: servicesTable.name,
    })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .leftJoin(servicesTable, eq(recurringInvoiceTemplatesTable.serviceId, servicesTable.id))
    .where(and(eq(recurringInvoiceTemplatesTable.id, id), eq(recurringInvoiceTemplatesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatTemplate(row.template, row.customerName, row.serviceName));
});

router.patch("/billing/recurring-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const { name, lineItems, billingCycleDay, billingCycleType, nextBillingDate, isActive, notes, customerId, serviceId, billingMode } = req.body;

  const [existing] = await db
    .select()
    .from(recurringInvoiceTemplatesTable)
    .where(and(eq(recurringInvoiceTemplatesTable.id, id), eq(recurringInvoiceTemplatesTable.tenantId, tenantId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (billingCycleType !== undefined && !BILLING_CYCLE_TYPES.has(billingCycleType)) {
    res.status(400).json({ error: `billingCycleType must be one of ${[...BILLING_CYCLE_TYPES].join(", ")}` });
    return;
  }
  if (billingMode !== undefined && !BILLING_MODES.has(billingMode)) {
    res.status(400).json({ error: `billingMode must be one of ${[...BILLING_MODES].join(", ")}` });
    return;
  }

  const effectiveCustomerId = customerId !== undefined ? (customerId != null ? parseInt(customerId, 10) : null) : existing.customerId;
  const effectiveServiceId = serviceId !== undefined ? (serviceId != null ? parseInt(serviceId, 10) : null) : existing.serviceId;
  const effectiveBillingMode = billingMode ?? existing.billingMode;

  if (!effectiveCustomerId && !effectiveServiceId) {
    res.status(400).json({ error: "At least one of customerId or serviceId is required" });
    return;
  }
  if (effectiveBillingMode === "static" && !effectiveCustomerId) {
    res.status(400).json({ error: "Static line-item templates require a customer" });
    return;
  }

  // Only validate monthly day/date consistency when a scheduling field is explicitly changed
  // in this request — unrelated edits (name, line items, active flag, etc.) on legacy records
  // are left intact so backward compatibility is preserved.
  if (billingCycleType !== undefined || billingCycleDay !== undefined || nextBillingDate !== undefined) {
    const effectiveType = billingCycleType ?? existing.billingCycleType;
    const effectiveDay = billingCycleDay !== undefined ? Number(billingCycleDay) : existing.billingCycleDay;
    const effectiveDate = nextBillingDate ?? existing.nextBillingDate;
    if (effectiveType === "monthly") {
      if (!Number.isInteger(effectiveDay) || effectiveDay < 1 || effectiveDay > 28) {
        res.status(400).json({ error: "billingCycleDay must be 1–28 for monthly templates" });
        return;
      }
      const dateDayOfMonth = parseInt((effectiveDate as string).split("-")[2] ?? "0", 10);
      if (dateDayOfMonth !== effectiveDay) {
        res.status(400).json({ error: `nextBillingDate day-of-month (${dateDayOfMonth}) must match billingCycleDay (${effectiveDay})` });
        return;
      }
    }
  }

  if (customerId !== undefined && effectiveCustomerId != null) {
    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, effectiveCustomerId), eq(customersTable.tenantId, tenantId)));
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  }
  if (serviceId !== undefined && effectiveServiceId != null) {
    const [service] = await db
      .select({ id: servicesTable.id })
      .from(servicesTable)
      .where(and(eq(servicesTable.id, effectiveServiceId), eq(servicesTable.tenantId, tenantId)));
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  }

  const updates: Partial<typeof recurringInvoiceTemplatesTable.$inferInsert> = {};
  if (customerId !== undefined) updates.customerId = effectiveCustomerId;
  if (serviceId !== undefined) updates.serviceId = effectiveServiceId;
  if (billingMode !== undefined) updates.billingMode = billingMode;
  if (name !== undefined) updates.name = name;
  if (lineItems !== undefined) updates.lineItems = lineItems;
  if (billingCycleDay !== undefined) updates.billingCycleDay = billingCycleDay;
  if (billingCycleType !== undefined) updates.billingCycleType = billingCycleType;
  if (nextBillingDate !== undefined) updates.nextBillingDate = nextBillingDate;
  if (isActive !== undefined) updates.isActive = isActive;
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db
    .update(recurringInvoiceTemplatesTable)
    .set(updates)
    .where(and(eq(recurringInvoiceTemplatesTable.id, id), eq(recurringInvoiceTemplatesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = updated.customerId
    ? await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId))
    : [undefined];
  const [serviceRow] = updated.serviceId
    ? await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.id, updated.serviceId))
    : [undefined];

  res.json(formatTemplate(updated, row?.name, serviceRow?.name));
});

router.delete("/billing/recurring-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db
    .delete(recurringInvoiceTemplatesTable)
    .where(and(eq(recurringInvoiceTemplatesTable.id, id), eq(recurringInvoiceTemplatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── Manual trigger ────────────────────────────────────────────────────────────

router.post("/billing/recurring-templates/:id/run-now", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { excludeJobIds } = req.body ?? {};

  if (excludeJobIds !== undefined && (!Array.isArray(excludeJobIds) || excludeJobIds.some((v: unknown) => typeof v !== "number"))) {
    res.status(400).json({ error: "excludeJobIds must be an array of job ids" });
    return;
  }

  try {
    const result = await runTemplateNow(id, tenantId, excludeJobIds ?? []);
    res.json({ success: true, invoiceId: result.invoiceId, invoiceIds: result.invoiceIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ── Preview completed-work billing before it goes out ─────────────────────────

router.get("/billing/recurring-templates/:id/preview", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  try {
    const preview = await previewTemplateBilling(id, tenantId);
    res.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

// ── Email queue retry ─────────────────────────────────────────────────────────

router.post("/billing/email-queue/:id/retry", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [entry] = await db
    .select()
    .from(billingEmailQueueTable)
    .where(and(eq(billingEmailQueueTable.id, id), eq(billingEmailQueueTable.tenantId, tenantId)));

  if (!entry) { res.status(404).json({ error: "Not found" }); return; }

  await db
    .update(billingEmailQueueTable)
    .set({ status: "pending", attempts: 0, errorMsg: null })
    .where(eq(billingEmailQueueTable.id, id));

  res.json({ success: true });
});

// ── Billing automation status ─────────────────────────────────────────────────

router.get("/billing/automation-status", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  // Today's generated invoices (via templates)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayInvoices = await db
    .select({
      invoice: invoicesTable,
      customerName: customersTable.name,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(
      and(
        eq(invoicesTable.tenantId, tenantId),
        sql`${invoicesTable.generatedFromTemplateId} IS NOT NULL`,
        sql`${invoicesTable.createdAt} >= ${todayStart}`,
      ),
    )
    .orderBy(desc(invoicesTable.createdAt));

  // All active templates with next run info
  const templates = await db
    .select({
      template: recurringInvoiceTemplatesTable,
      customerName: customersTable.name,
      serviceName: servicesTable.name,
    })
    .from(recurringInvoiceTemplatesTable)
    .leftJoin(customersTable, eq(recurringInvoiceTemplatesTable.customerId, customersTable.id))
    .leftJoin(servicesTable, eq(recurringInvoiceTemplatesTable.serviceId, servicesTable.id))
    .where(eq(recurringInvoiceTemplatesTable.tenantId, tenantId))
    .orderBy(recurringInvoiceTemplatesTable.nextBillingDate);

  // Email queue entries (last 100)
  const emailQueue = await db
    .select({
      queue: billingEmailQueueTable,
      invoiceNumber: invoicesTable.invoiceNumber,
    })
    .from(billingEmailQueueTable)
    .leftJoin(invoicesTable, eq(billingEmailQueueTable.invoiceId, invoicesTable.id))
    .where(eq(billingEmailQueueTable.tenantId, tenantId))
    .orderBy(desc(billingEmailQueueTable.createdAt))
    .limit(100);

  // Queue stats
  const [stats] = await db
    .select({
      pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')::int`,
      sent: sql<number>`COUNT(*) FILTER (WHERE status = 'sent')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE status = 'failed')::int`,
    })
    .from(billingEmailQueueTable)
    .where(eq(billingEmailQueueTable.tenantId, tenantId));

  res.json({
    todayInvoices: todayInvoices.map(r => ({
      id: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      total: r.invoice.total,
      status: r.invoice.status,
      customerName: r.customerName,
      generatedFromTemplateId: r.invoice.generatedFromTemplateId,
      createdAt: r.invoice.createdAt.toISOString(),
    })),
    templates: templates.map(r => formatTemplate(r.template, r.customerName, r.serviceName)),
    emailQueue: emailQueue.map(r => formatQueueEntry(r.queue, r.invoiceNumber)),
    queueStats: stats ?? { pending: 0, sent: 0, failed: 0 },
  });
});

export default router;
