import { db, tenantsTable, invoiceTemplatesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Resolve once when creating a document; never resolve over an issued invoice. */
export async function invoiceDocumentDefaults(tenantId: number, templateId?: number | null) {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const id = templateId ?? tenant?.defaultInvoiceTemplateId;
  const [template] = id ? await db.select().from(invoiceTemplatesTable)
    .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId))) : [];
  return {
    invoiceTemplateId: template?.id ?? null,
    layout: template?.layout ?? "clean",
    notes: template?.notes ?? tenant?.defaultInvoiceNotes ?? null,
    termsText: template?.termsText ?? tenant?.defaultInvoiceTerms ?? null,
    lateFeeEnabled: template?.lateFeeEnabled ?? false,
    lateFeeType: template?.lateFeeType ?? null,
    lateFeeAmount: template?.lateFeeAmount ?? null,
    lateFeeDaysGrace: template?.lateFeeDaysGrace ?? 0,
    lateFeeSchedule: template?.lateFeeSchedule ?? [],
    showJobCompletionDate: template?.showJobCompletionDate ?? false,
  };
}
