import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, customersTable, jobsTable, invoicesTable, billingEmailQueueTable, activityLogTable } from "@workspace/db";
import { holdUnpricedJobs, recurringBillingDue } from "./billingAutomation";
import { processRecurringJobBatches } from "./recurringJobBilling";

describe("billing automation", () => {
  it("uses tenant-calendar cadence rather than one invoice per visit", () => {
    expect(recurringBillingDue("monthly", "America/Denver", new Date("2026-11-01T16:00:00Z"))).toBe(true);
    expect(recurringBillingDue("monthly", "America/Denver", new Date("2026-11-02T16:00:00Z"))).toBe(false);
    expect(recurringBillingDue("bi_monthly", "UTC", new Date("2026-11-15T16:00:00Z"))).toBe(true);
    expect(recurringBillingDue("weekly", "UTC", new Date("2026-11-02T16:00:00Z"))).toBe(true);
    expect(recurringBillingDue("off", "UTC")).toBe(false);
  });
  it("groups priced recurring jobs in drafts, holds missing prices, avoids duplicates, and only queues automatic delivery", async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name: "Billing QA", slug: `billing-${randomUUID()}`, timezone: "UTC", autoInvoiceFrequency: "daily", invoiceDeliveryMode: "review" }).returning();
    try {
      const [customer] = await db.insert(customersTable).values({ tenantId: tenant.id, name: "Billing QA", email: "billing-qa@example.invalid", phone: "", autoInvoiceOnCompletion: true }).returning();
      const createJob = async (amount: number, recurring = true) => (await db.insert(jobsTable).values({
        tenantId: tenant.id, customerId: customer.id, title: "QA visit", status: "completed", scheduledAt: new Date(),
        completedAt: new Date(), totalAmount: amount, recurrenceRule: recurring ? { frequency: "weekly" } : null,
      }).returning())[0];
      await createJob(50);
      await createJob(75);
      const unpriced = await createJob(0);
      const oneOff = await createJob(80, false);
      await holdUnpricedJobs(tenant.id);
      await processRecurringJobBatches(new Date(), tenant.id);
      let invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe("draft");
      expect(invoices[0].subtotal).toBe(125);
      expect(invoices[0].publicToken).toBeNull();
      expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id))).toHaveLength(0);
      const [held] = await db.select().from(jobsTable).where(eq(jobsTable.id, unpriced.id));
      expect(held.holdFromBilling).toBe(true);
      expect(held.invoiceId).toBeNull();
      expect((await db.select().from(jobsTable).where(eq(jobsTable.id, oneOff.id)))[0].invoiceId).toBeNull();
      await processRecurringJobBatches(new Date(), tenant.id);
      expect(await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id))).toHaveLength(1);
      await db.update(tenantsTable).set({ invoiceDeliveryMode: "automatic" }).where(eq(tenantsTable.id, tenant.id));
      await createJob(40);
      await processRecurringJobBatches(new Date(), tenant.id);
      invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      expect(invoices.filter(i => i.status === "sent")).toHaveLength(1);
      expect(invoices.find(i => i.status === "sent")?.publicToken).toBeTruthy();
      expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id))).toHaveLength(1);
    } finally {
      await db.delete(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id));
      await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenant.id));
      await db.update(jobsTable).set({ invoiceId: null }).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
