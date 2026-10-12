import { db, tenantsTable, jobsTable, activityLogTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export async function automaticInvoiceSending(tenantId: number): Promise<boolean> {
  const [tenant] = await db.select({ mode: tenantsTable.invoiceDeliveryMode }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return tenant?.mode === "automatic";
}

/** Missing and zero prices must never enter automatic billing or email delivery. */
export async function holdUnpricedJobs(tenantId?: number): Promise<void> {
  const held = await db.update(jobsTable).set({ holdFromBilling: true })
    .where(and(
      tenantId === undefined ? sql`true` : eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.status, "completed"), isNull(jobsTable.invoiceId),
      isNull(jobsTable.planId),
      eq(jobsTable.holdFromBilling, false), sql`COALESCE(${jobsTable.totalAmount}, 0) <= 0`,
    )).returning({ id: jobsTable.id, tenantId: jobsTable.tenantId });
  for (const job of held) await db.insert(activityLogTable).values({
    tenantId: job.tenantId, type: "billing_review_required", entityId: job.id, userId: null,
    message: "Completed job held for billing review: no positive customer price. Set the price and release the billing hold, or handle intentionally free/plan-covered work separately.",
  });
}

export function recurringBillingDue(frequency: string, timezone: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric", weekday: "short" }).formatToParts(now);
  const day = Number(parts.find(p => p.type === "day")?.value);
  const weekday = parts.find(p => p.type === "weekday")?.value;
  return frequency === "daily" || frequency === "weekly" && weekday === "Mon" ||
    frequency === "bi_monthly" && (day === 1 || day === 15) || frequency === "monthly" && day === 1 ||
    frequency === "weekly_friday" && weekday === "Fri" || frequency === "monthly_15" && day === 15 ||
    frequency === "biweekly" && weekday === "Mon" && Math.floor(now.getTime() / (7 * 86400000)) % 2 === 0;
}
