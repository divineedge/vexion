import { db, jobsTable, invoicesTable, customersTable, recurringInvoiceTemplatesTable, tenantsTable, taskNotificationsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { creditedInvoiceInsert } from "./customerCredit";
import { invoiceDocumentDefaults } from "./invoiceDocumentDefaults";
import { datedJobInvoiceItems } from "./invoiceServiceDate";
import { randomUUID } from "node:crypto";

export async function billingCoverage(tenantId: number, recover = false) {
  const rows = await db.select({ job: jobsTable, customerName: customersTable.name, customerArchivedAt: customersTable.archivedAt, invoice: invoicesTable })
    .from(jobsTable).leftJoin(customersTable, eq(customersTable.id, jobsTable.customerId))
    .leftJoin(invoicesTable, eq(invoicesTable.id, jobsTable.invoiceId))
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.status, "completed"),
      sql`(${jobsTable.invoiceId} IS NULL OR ${invoicesTable.id} IS NULL OR ${invoicesTable.status} IN ('void','cancelled') OR ${invoicesTable.archivedAt} IS NOT NULL)`));
  const templates = await db.select().from(recurringInvoiceTemplatesTable).where(and(eq(recurringInvoiceTemplatesTable.tenantId, tenantId), eq(recurringInvoiceTemplatesTable.isActive, true)));
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const result = [];
  for (const { job, customerName, customerArchivedAt } of rows) {
    const template = templates.find(t => t.billingMode === "completed_work" && (t.customerId == null || t.customerId === job.customerId) && (t.serviceId == null || t.serviceId === job.serviceId));
    let needsAttention = true;
    let reason = customerArchivedAt ? "Archived customer has unbilled completed work: admin review required" : !job.customerId ? "Missing customer" : job.invoiceId ? "Linked invoice is void, missing, or archived" :
      job.planId ? "Plan visit: verify that its service period is included in the plan invoice" :
      job.holdFromBilling ? "Billing hold: review and release when ready" :
      !(job.totalAmount > 0) ? "Missing price or intentionally free work: admin review required" :
      !job.completedAt ? "Missing completion timestamp" : "Completed job has no invoice";
    if (!customerArchivedAt && !job.invoiceId && !job.planId && job.customerId && !job.holdFromBilling && job.totalAmount > 0 && job.completedAt) {
      if (template || job.recurrenceRule || job.recurrenceParentId || job.pendingWeeklyInvoice) {
        const age = Date.now() - job.completedAt.getTime();
        const maxDays = tenant.autoInvoiceFrequency === "daily" ? 2 : tenant.autoInvoiceFrequency.startsWith("weekly") ? 8 : tenant.autoInvoiceFrequency === "biweekly" || tenant.autoInvoiceFrequency === "bi_monthly" ? 17 : 35;
        needsAttention = age > maxDays * 86400000 || !!template && template.nextBillingDate < new Date().toISOString().slice(0, 10);
        reason = needsAttention ? "Billing cycle overdue: completed work still has no invoice" : "Waiting for scheduled billing cycle";
      } else if (recover) {
        try {
          await db.transaction(async tx => {
            const [locked] = await tx.select().from(jobsTable).where(and(eq(jobsTable.id, job.id), isNull(jobsTable.invoiceId))).for("update");
            if (!locked || locked.status !== "completed" || locked.holdFromBilling || !(locked.totalAmount > 0)) return;
            const [invoice] = await creditedInvoiceInsert(tx).values({
              ...await invoiceDocumentDefaults(tenantId), tenantId, customerId: locked.customerId!,
              jobId: locked.id, invoiceNumber: `INV-${randomUUID().slice(0, 12)}`, status: "draft",
              subtotal: locked.totalAmount, tax: Math.round(locked.totalAmount * (tenant.taxRate / 100) * 100) / 100,
              total: Math.round(locked.totalAmount * (1 + tenant.taxRate / 100) * 100) / 100,
              lineItems: await datedJobInvoiceItems(tenantId, locked),
            }).returning();
            await tx.update(jobsTable).set({ invoiceId: invoice.id, pendingWeeklyInvoice: false }).where(eq(jobsTable.id, locked.id));
          });
          reason = "Recovered into a draft invoice: admin review required";
        } catch { reason = "Invoice generation failed: admin action required"; }
      }
    }
    result.push({ id: job.id, title: job.title, customerId: job.customerId, customerName, completedAt: job.completedAt, totalAmount: job.totalAmount, reason, needsAttention, invoiceId: job.invoiceId });
    if (recover && needsAttention) {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${job.id})`);
        const admins = await tx.select().from(usersTable).where(and(eq(usersTable.tenantId, tenantId), sql`${usersTable.role} IN ('company_owner','office_manager','department_manager')`));
        for (const admin of admins) {
          const message = `Billing review — job #${job.id} "${job.title}": ${reason}`;
          const existing = await tx.select({ id: taskNotificationsTable.id }).from(taskNotificationsTable).where(and(eq(taskNotificationsTable.recipientUserId, admin.id), eq(taskNotificationsTable.message, message)));
          if (!existing.length) await tx.insert(taskNotificationsTable).values({ tenantId, recipientUserId: admin.id, type: "billing_review", message, linkPath: "/invoices" });
        }
      });
    }
  }
  return { jobs: result, checkedAt: new Date().toISOString() };
}

export async function auditAllBilling() {
  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
  for (const tenant of tenants) {
    try { await billingCoverage(tenant.id, true); }
    catch (error) { console.error("Billing coverage audit failed", tenant.id, error); }
  }
}
