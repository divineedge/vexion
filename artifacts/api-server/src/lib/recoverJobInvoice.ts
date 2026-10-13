import { db, jobsTable, invoicesTable, customersTable, tenantsTable, recurringInvoiceTemplatesTable, taskNotificationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { creditedInvoiceInsert } from "./customerCredit";
import { datedJobInvoiceItems } from "./invoiceServiceDate";
import { invoiceDocumentDefaults } from "./invoiceDocumentDefaults";

const reject = (message: string, status=422): never => {throw Object.assign(new Error(message),{status});};
export async function recoverJobInvoice(tenantId: number, jobId: number, actorId: number, reason?: string) {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobsTable).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,jobId))).for("update");
    if (!job) reject("Job not found",404);
    if (job.invoiceId) {
      const [prior] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.tenantId,tenantId),eq(invoicesTable.id,job.invoiceId)));
      if (prior && !["void","cancelled"].includes(prior.status)) return {invoiceId:prior.id,existing:true};
    }
    if (job.status!=="completed") reject("Complete this job before invoicing");
    const customerId = job.customerId;
    if (!customerId) throw Object.assign(new Error("Add a customer to this job first"),{status:422});
    if (job.holdFromBilling) reject("Review and release this job's billing hold first");
    if (job.planId) reject("Review this visit's plan billing first. Creating a separate invoice could double bill the customer.");
    if (!Number.isFinite(job.totalAmount) || !(job.totalAmount>0)) reject("Set the job's price first, or record it as intentionally no-charge");
    if (!job.completedAt) reject("Record the job's actual completion date first");
    const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,customerId)));
    if (!customer || customer.archivedAt) reject("Restore or correct the customer before invoicing");
    const templates = await tx.select().from(recurringInvoiceTemplatesTable).where(and(eq(recurringInvoiceTemplatesTable.tenantId,tenantId),eq(recurringInvoiceTemplatesTable.isActive,true)));
    const recurring = job.recurrenceRule || job.recurrenceParentId || job.pendingWeeklyInvoice || templates.some(t=>t.billingMode==="completed_work" && (t.customerId==null || t.customerId===job.customerId) && (t.serviceId==null || t.serviceId===job.serviceId));
    if (recurring && !reason?.trim()) reject("Provide a reason for billing recurring work before its normal cycle",400);
    const [tenant] = await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    const subtotal = Math.round(job.totalAmount*100)/100;
    const tax = Math.round(subtotal*tenant.taxRate)/100;
    const [invoice] = await creditedInvoiceInsert(tx).values({
      ...await invoiceDocumentDefaults(tenantId),tenantId,customerId,jobId:job.id,
      invoiceNumber:`INV-${randomUUID().slice(0,12)}`,status:"draft",subtotal,tax,
      total:Math.round((subtotal+tax)*100)/100,lineItems:await datedJobInvoiceItems(tenantId,job),
    }).returning();
    await tx.update(jobsTable).set({invoiceId:invoice.id,pendingWeeklyInvoice:false}).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,job.id)));
    await tx.insert(taskNotificationsTable).values({
      tenantId,recipientUserId:actorId,type:"billing_recovery",
      message:`Staff #${actorId} created draft ${invoice.invoiceNumber} for job #${job.id}${reason?.trim()?`: ${reason.trim()}`:""}`,
      linkPath:`/invoices?invoiceId=${invoice.id}`,
    });
    return {invoiceId:invoice.id,existing:false};
  });
}
