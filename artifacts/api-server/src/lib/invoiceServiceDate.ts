import { normalizeFieldRequirements } from "./serviceFieldRequirements";
import { db, servicesTable, tenantsTable, type Job } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function datedJobInvoiceItems(tenantId: number, job: Job) {
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [service] = job.serviceId ? await db.select({ requirements: servicesTable.fieldRequirements }).from(servicesTable).where(and(eq(servicesTable.id, job.serviceId), eq(servicesTable.tenantId, tenantId))) : [];
  const date = invoiceServiceDate(job, service?.requirements, tenant?.timezone ?? "America/New_York");
  const items = (job.lineItems as Array<Record<string, unknown>>) ?? [];
  return (items.length ? items : [{ description: job.title, quantity: 1, unitPrice: job.totalAmount, total: job.totalAmount }])
    .map(item => ({ ...item, description: `${item.description || job.title}${date ? ` — ${date}` : ""}` }));
}

export function invoiceServiceDate(job: { scheduledAt: Date; completedAt: Date | null }, requirements: unknown, timezone: string): string | null {
  const basis = normalizeFieldRequirements(requirements).invoiceDateBasis;
  const date = basis === "scheduled" ? job.scheduledAt : job.completedAt;
  // Never mislabel scheduled work as completed when the completion is unknown.
  if (!date) return null;
  const formatted = date.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });
  return `${basis === "scheduled" ? "Scheduled" : "Completed"} ${formatted}`;
}
