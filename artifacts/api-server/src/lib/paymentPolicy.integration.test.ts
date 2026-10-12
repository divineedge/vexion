import { describe, it, expect } from "vitest";
import { db, tenantsTable, customersTable, jobsTable, invoicesTable, customerCreditsTable, estimatesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { paymentGuardedJobInsert, resolvePaymentPolicy, emptyPaymentPolicy } from "./paymentPolicy";
import { creditedInvoiceInsert, invoiceBalance } from "./customerCredit";
describe("payment requirements", () => {
  it("uses customer deposit overrides and cannot waive company-wide prepayment", () => {
    expect(resolvePaymentPolicy({ ...emptyPaymentPolicy, depositType:"percent", depositValue:20, requirePrepay:true },
      { ...emptyPaymentPolicy, depositType:"fixed", depositValue:30 },
      { ...emptyPaymentPolicy, depositType:"fixed", depositValue:10, requirePrepay:false })).toMatchObject({depositType:"fixed",depositValue:10,requirePrepay:true});
  });
  it("blocks unpaid jobs, reserves advance funds, requires saved cards, and applies deposits only once", async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name:"QA payment requirements", taxRate:0 }).returning();
    try {
      const [customer] = await db.insert(customersTable).values({ tenantId:tenant.id, name:"Payment QA", email:"", phone:"" }).returning();
      await db.execute(sql`UPDATE customers SET payment_policy='{"requirePrepay":true}'::jsonb WHERE id=${customer.id}`);
      const input = { tenantId:tenant.id, customerId:customer.id, title:"Paid first", scheduledAt:new Date(), totalAmount:100, status:"scheduled" };
      await expect(paymentGuardedJobInsert(db).values(input)).rejects.toThrow("Full prepayment");
      expect(await db.select().from(jobsTable).where(eq(jobsTable.tenantId, tenant.id))).toHaveLength(0);
      await db.insert(customerCreditsTable).values({ tenantId:tenant.id, customerId:customer.id, amount:100, kind:"prepayment", reference:"Test", requestId:"one" });
      const [job] = await paymentGuardedJobInsert(db).values(input).returning();
      const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, job.invoiceId!));
      expect(invoice.total).toBe(100);
      expect(invoice.creditApplied).toBe(100);
      expect(invoiceBalance(invoice)).toBe(0);
      await expect(paymentGuardedJobInsert(db).values(input)).rejects.toThrow("Full prepayment");
      await db.execute(sql`UPDATE customers SET payment_policy='{"requireCard":true}'::jsonb WHERE id=${customer.id}`);
      await expect(paymentGuardedJobInsert(db).values(input)).rejects.toThrow("saved credit card");
      await db.execute(sql`UPDATE customers SET payment_policy=null WHERE id=${customer.id}`);
      const [estimate] = await db.insert(estimatesTable).values({ tenantId:tenant.id, customerId:customer.id, total:100, paymentRequirement:"deposit_fixed", depositValue:25, depositPaidAt:new Date(), depositChargedAmount:25 }).returning();
      const [depositJob] = await paymentGuardedJobInsert(db).values({ ...input, estimateId:estimate.id }).returning();
      const [depositInvoice] = await creditedInvoiceInsert(db,true).values({ tenantId:tenant.id, customerId:customer.id, jobId:depositJob.id, invoiceNumber:"DEPOSIT-QA",total:100,subtotal:100,status:"draft" }).returning();
      expect(depositInvoice.depositApplied).toBe(25);
      expect(depositInvoice.creditApplied).toBe(0);
      expect(invoiceBalance(depositInvoice)).toBe(75);
      const [duplicate] = await creditedInvoiceInsert(db).values({ tenantId:tenant.id, customerId:customer.id, jobId:depositJob.id, invoiceNumber:"DEPOSIT-DUPLICATE-QA", total:100,status:"draft" }).returning();
      expect(duplicate.depositApplied).toBe(0);
    } finally {
      await db.delete(customerCreditsTable).where(eq(customerCreditsTable.tenantId,tenant.id));
      await db.update(jobsTable).set({invoiceId:null}).where(eq(jobsTable.tenantId,tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId,tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId,tenant.id));
      await db.delete(estimatesTable).where(eq(estimatesTable.tenantId,tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId,tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id,tenant.id));
    }
  });
});
