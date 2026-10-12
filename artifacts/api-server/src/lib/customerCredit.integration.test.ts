import { describe, it, expect } from "vitest";
import { db, tenantsTable, customersTable, customerCreditsTable, invoicesTable, jobsTable, taskNotificationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { creditedInvoiceInsert, creditBalance, invoiceBalance, voidCreditedInvoice } from "./customerCredit";
import { billingCoverage } from "./billingCoverage";
describe("billing safety", () => {
  it("reserves prepaid funds once across concurrent invoices and recovers unbilled work idempotently", async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name: "QA credit safety", taxRate: 0 }).returning();
    try {
      const [customer] = await db.insert(customersTable).values({ tenantId: tenant.id, name: "Credit QA", email: "", phone: "" }).returning();
      await db.insert(customerCreditsTable).values({ tenantId: tenant.id, customerId: customer.id, amount: 100, kind: "prepayment", reference: "Test receipt", requestId: "test" });
      const invoices = await Promise.all([1, 2].map(n => creditedInvoiceInsert(db).values({ tenantId: tenant.id, customerId: customer.id, invoiceNumber: `QA-${n}`, total: 75, subtotal: 75, status: "sent" }).returning()));
      expect(invoices.flat().reduce((s, i) => s + i.creditApplied, 0)).toBe(100);
      expect(invoices.flat().reduce((s, i) => s + invoiceBalance(i), 0)).toBe(50);
      expect(await creditBalance(db, tenant.id, customer.id)).toBe(0);
      expect(invoices.flat().filter(i => i.status === "paid")).toHaveLength(1);
      const full = invoices.flat().find(i => i.status === "paid")!;
      await voidCreditedInvoice(tenant.id, full.id, 0);
      await voidCreditedInvoice(tenant.id, full.id, 0);
      expect(await creditBalance(db, tenant.id, customer.id)).toBe(75);
      const [job] = await db.insert(jobsTable).values({ tenantId: tenant.id, customerId: customer.id, title: "Missed job", status: "completed", completedAt: new Date(), scheduledAt: new Date(), totalAmount: 40 }).returning();
      await Promise.all([billingCoverage(tenant.id, true), billingCoverage(tenant.id, true)]);
      const [saved] = await db.select().from(jobsTable).where(eq(jobsTable.id, job.id));
      expect(saved.invoiceId).toBeTruthy();
      expect((await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, job.id)))).toHaveLength(1);
      await db.insert(jobsTable).values({ tenantId: tenant.id, customerId: customer.id, title: "Unpriced", status: "completed", completedAt: new Date(), scheduledAt: new Date(), totalAmount: 0 });
      await db.insert(usersTable).values({ tenantId:tenant.id, name:"QA admin", email:`billing-${tenant.id}@example.invalid`, role:"company_owner" });
      const report = await billingCoverage(tenant.id, true);
      expect(report.jobs.some(j => j.title === "Unpriced" && j.needsAttention)).toBe(true);
      expect((await db.select().from(taskNotificationsTable).where(eq(taskNotificationsTable.tenantId,tenant.id))).some(n => n.type === "billing_review" && n.taskId === null)).toBe(true);
    } finally {
      await db.delete(taskNotificationsTable).where(eq(taskNotificationsTable.tenantId, tenant.id));
      await db.delete(customerCreditsTable).where(eq(customerCreditsTable.tenantId, tenant.id));
      await db.update(jobsTable).set({ invoiceId: null }).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenant.id));
      await db.delete(usersTable).where(eq(usersTable.tenantId,tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
