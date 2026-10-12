import { db, tenantsTable, customersTable, jobsTable, servicesTable, recurringInvoiceTemplatesTable, invoicesTable, billingEmailQueueTable } from "@workspace/db";
import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { recurringBillingDue } from "./billingAutomation";
import { invoiceDocumentDefaults } from "./invoiceDocumentDefaults";
import { invoiceServiceDate } from "./invoiceServiceDate";

/** Templates run first and own their scopes; standalone recurring visits are batched here. */
export async function processRecurringJobBatches(now = new Date(), onlyTenantId?: number) {
  const tenants = await db.select().from(tenantsTable).where(onlyTenantId ? eq(tenantsTable.id, onlyTenantId) : sql`true`);
  for (const tenant of tenants) {
    if (!recurringBillingDue(tenant.autoInvoiceFrequency, tenant.timezone, now)) continue;
    const customers = await db.select().from(customersTable).where(and(eq(customersTable.tenantId, tenant.id), eq(customersTable.autoInvoiceOnCompletion, true), isNull(customersTable.archivedAt)));
    for (const customer of customers) await db.transaction(async tx => {
      const templates = await tx.select().from(recurringInvoiceTemplatesTable).where(and(eq(recurringInvoiceTemplatesTable.tenantId, tenant.id), eq(recurringInvoiceTemplatesTable.isActive, true)));
      const rows = await tx.select().from(jobsTable).where(and(
        eq(jobsTable.tenantId, tenant.id), eq(jobsTable.customerId, customer.id),
        eq(jobsTable.status, "completed"), isNull(jobsTable.invoiceId), isNull(jobsTable.invoiceClaimLockAt),
        eq(jobsTable.holdFromBilling, false), isNull(jobsTable.planId),
        sql`${jobsTable.totalAmount} > 0`, sql`${jobsTable.completedAt} IS NOT NULL`,
        sql`(${jobsTable.recurrenceRule} IS NOT NULL OR ${jobsTable.recurrenceParentId} IS NOT NULL)`,
      )).for("update", { skipLocked: true });
      const jobs = rows.filter(job => !templates.some(template =>
        (template.customerId === customer.id || template.customerId == null) &&
        (template.serviceId == null || template.serviceId === job.serviceId)));
      if (!jobs.length) return;
      const services = await tx.select().from(servicesTable).where(eq(servicesTable.tenantId, tenant.id));
      const requirements = new Map(services.map(service => [service.id, service.fieldRequirements]));
      const lineItems = jobs.map(job => ({
        description: `${job.title} — ${invoiceServiceDate(job, requirements.get(job.serviceId ?? 0), tenant.timezone)}`,
        quantity: 1, unitPrice: job.totalAmount, total: job.totalAmount,
      }));
      const subtotal = lineItems.reduce((sum, line) => sum + line.total, 0);
      const tax = Math.round(subtotal * (tenant.taxRate / 100) * 100) / 100;
      const send = tenant.invoiceDeliveryMode === "automatic" && !!customer.email;
      const [invoice] = await tx.insert(invoicesTable).values({
        ...await invoiceDocumentDefaults(tenant.id),
        tenantId: tenant.id, customerId: customer.id, invoiceNumber: `INV-${randomBytes(6).toString("hex").toUpperCase()}`,
        status: send ? "sent" : "draft", publicToken: send ? randomBytes(32).toString("hex") : null,
        lineItems, subtotal, tax, total: subtotal + tax,
      }).returning();
      await tx.update(jobsTable).set({ invoiceId: invoice.id, pendingWeeklyInvoice: false }).where(inArray(jobsTable.id, jobs.map(job => job.id)));
      if (send) await tx.insert(billingEmailQueueTable).values({ tenantId: tenant.id, invoiceId: invoice.id, status: "pending", attempts: 0 });
    });
  }
}
