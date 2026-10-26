import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
const fixture=vi.hoisted(()=>({connection:null as any}));
vi.mock("@workspace/db",async original=>{
  const module=await original<typeof import("@workspace/db")>();
  return {...module,db:new Proxy(module.db,{get(target,key){const current=fixture.connection??target,value=current[key];return typeof value==="function"?value.bind(current):value;}})};
});
import { db, pool, tenantsTable, customersTable, jobsTable, invoicesTable, customerCreditsTable, estimatesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { paymentGuardedJobInsert, resolvePaymentPolicy, emptyPaymentPolicy } from "./paymentPolicy";
import { creditedInvoiceInsert, invoiceBalance } from "./customerCredit";
describe("payment requirements", () => {
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>,savepoint=0;
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    const raw=drizzle(client);
    fixture.connection=new Proxy(raw,{get(target,key){
      if(key==="transaction")return async(callback:(tx:any)=>Promise<unknown>)=>{
        const name=`policy_fixture_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);
        try{const result=await callback(fixture.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
        catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}
      };
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
  });
  afterAll(async()=>{if(client){try{await client.query("ROLLBACK");}finally{fixture.connection=null;client.release();await pool.end();}}});
  it("uses customer deposit overrides and cannot waive company-wide prepayment", () => {
    expect(resolvePaymentPolicy({ ...emptyPaymentPolicy, depositType:"percent", depositValue:20, requirePrepay:true },
      { ...emptyPaymentPolicy, depositType:"fixed", depositValue:30 },
      { ...emptyPaymentPolicy, depositType:"fixed", depositValue:10, requirePrepay:false })).toMatchObject({depositType:"fixed",depositValue:10,requirePrepay:true});
  });
  it("blocks unpaid jobs, reserves advance funds, requires saved cards, and applies deposits only once", async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name:"QA payment requirements", taxRate:0 }).returning();
    {
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
      await db.update(customersTable).set({stripeDefaultPaymentMethodId:"pm_bank_fixture",stripeDefaultPaymentMethodType:"us_bank_account"}).where(eq(customersTable.id,customer.id));
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
    }
  });
});
