import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import express from "express";
import request from "supertest";
import {drizzle} from "drizzle-orm/node-postgres";
import {and,eq} from "drizzle-orm";
import {randomUUID,createHash} from "node:crypto";

const scope=vi.hoisted(()=>({tenant:0,user:0,connection:null as any}));
const gateway=vi.hoisted(()=>({checkout:{sessions:{create:vi.fn().mockResolvedValue({url:"https://checkout.example.invalid/fixture"})}},webhooks:{constructEvent:vi.fn()},paymentIntents:{retrieve:vi.fn().mockResolvedValue({customer:"cus_qa",payment_method:"pm_qa"})},paymentMethods:{retrieve:vi.fn().mockResolvedValue({id:"pm_qa",customer:"cus_qa",card:{brand:"visa",last4:"4242",exp_year:2030,exp_month:11}})}}));
vi.mock("../lib/stripe",()=>({getStripeClient:()=>gateway,getStripePublishableKey:()=>"pk_test_fixture",ensureStripeCustomer:async()=>"cus_qa"}));
// Portal owns a second Stripe factory; mock the SDK too so no test can call a gateway.
vi.mock("stripe",()=>({default:class FixtureStripe{constructor(){return gateway;}}}));
vi.mock("@workspace/db",async original=>{
  const base=await original<typeof import("@workspace/db")>();
  return {...base,db:new Proxy(base.db,{get(target,key){const current=scope.connection??target;const value=current[key];return typeof value==="function"?value.bind(current):value;}})};
});
vi.mock("../lib/tenantHelper",()=>({getTenantId:()=>scope.tenant,getUserId:()=>scope.user}));
vi.mock("../lib/verifiedStaff",()=>({requireVerifiedStaff:(_req:unknown,_res:unknown,next:()=>void)=>next()}));
import {db,pool,tenantsTable,usersTable,customersTable,jobsTable,invoicesTable,customerCreditsTable,inventoryItemsTable,inventoryLocationsTable,inventoryLocationStockTable,expenseEntriesTable,subTimersTable,estimatesTable,internalTasksTable,taskNotificationsTable,customerOtpSessionsTable} from "@workspace/db";
import expenses from "./expenses";
import pricing from "./pricingReview";
import safety from "./billingSafety";
import policies from "./paymentPolicy";
import {paymentGuardedJobInsert} from "../lib/paymentPolicy";
import reminderSettings from "./estimateReminders";
import portal from "./portal";
import {processEstimateReminders} from "../lib/estimateReminderScheduler";
import {sql} from "drizzle-orm";

describe("rollback-only pricing, inventory and invoice recovery",()=>{
  let client:any,serial=0,customer:number,item:number,warehouse:number,job:number,otherTenant:number;
  const app=express();
  app.use(express.json({verify:(req,_res,buffer)=>{(req as any).rawBody=buffer;}}),expenses,pricing,safety,policies,reminderSettings,portal);
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    const raw=drizzle(client);
    // Nested helpers get savepoints, never COMMIT the surrounding fixture transaction.
    const connection:any=new Proxy(raw,{get(target,key){
      if(key==="transaction")return async(fn:(tx:any)=>Promise<unknown>)=>{
        const name=`qa_savepoint_${++serial}`;await client.query(`SAVEPOINT ${name}`);
        try{const result=await fn(connection);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
        catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);throw error;}
      };
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
    scope.connection=connection;
    scope.tenant=(await db.insert(tenantsTable).values({name:"Rollback money QA",timezone:"UTC",taxRate:0}).returning())[0].id;
    otherTenant=(await db.insert(tenantsTable).values({name:"Rollback other QA",timezone:"UTC"}).returning())[0].id;
    scope.user=(await db.insert(usersTable).values({tenantId:scope.tenant,name:"QA owner",email:`${randomUUID()}@example.invalid`,role:"company_owner"}).returning())[0].id;
    customer=(await db.insert(customersTable).values({tenantId:scope.tenant,name:"QA customer",email:"qa@example.invalid",phone:""}).returning())[0].id;
    warehouse=(await db.insert(inventoryLocationsTable).values({tenantId:scope.tenant,name:"QA warehouse",type:"warehouse"}).returning())[0].id;
    item=(await db.insert(inventoryItemsTable).values({tenantId:scope.tenant,name:"QA supplies",sku:"QA-ONE",quantity:10,unitPrice:10,markedUpPrice:15}).returning())[0].id;
    job=(await db.insert(jobsTable).values({tenantId:scope.tenant,customerId:customer,title:"QA completed job",status:"completed",scheduledAt:new Date(),completedAt:new Date(),totalAmount:40,jobParts:[{total:15}]}).returning())[0].id;
    await db.insert(subTimersTable).values({tenantId:scope.tenant,userId:scope.user,type:"job",label:"QA work",jobId:job,elapsedSeconds:3600,isActive:false,stoppedAt:new Date()});
  });
  afterAll(async()=>{vi.unstubAllEnvs();scope.connection=null;if(client){await client.query("ROLLBACK");client.release();}});
  it("receives once, preserves old stock and markup, and rolls back invalid receipts",async()=>{
    const body={date:new Date().toISOString().slice(0,10),amount:60,requestId:randomUUID(),inventoryReceipts:[{inventoryItemId:item,quantity:3,costPrice:20,updatePrice:true}]};
    const first=await request(app).post("/expenses").send(body);
    expect(first.status,JSON.stringify(first.body)).toBe(201);
    expect(first.body.inventoryReceipts[0]).toMatchObject({itemName:"QA supplies",newSellPrice:30,locationId:warehouse});
    const replay=await request(app).post("/expenses").send(body);expect(replay.body.id).toBe(first.body.id);
    expect((await request(app).post("/expenses").send({...body,amount:61})).status).toBe(409);
    const [saved]=await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id,item));
    expect(saved).toMatchObject({quantity:13,unitPrice:20,markedUpPrice:30});
    const stocks=await db.select().from(inventoryLocationStockTable).where(eq(inventoryLocationStockTable.inventoryItemId,item));
    expect(stocks.reduce((sum,s)=>sum+s.quantity,0)).toBe(13);
    expect((await request(app).delete(`/expenses/${first.body.id}`)).status).toBe(409);
    const foreign=(await db.insert(inventoryItemsTable).values({tenantId:otherTenant,name:"Foreign",sku:"QA-FOREIGN",quantity:0,unitPrice:1,markedUpPrice:1}).returning())[0].id;
    const failed=await request(app).post("/expenses").send({...body,requestId:randomUUID(),amount:100,inventoryReceipts:[{...body.inventoryReceipts[0],locationId:warehouse},{inventoryItemId:foreign,quantity:1,costPrice:1,updatePrice:false}]});
    expect(failed.status).toBe(400);
    expect((await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id,item)))[0].quantity).toBe(13);
    expect(await db.select().from(expenseEntriesTable).where(eq(expenseEntriesTable.tenantId,scope.tenant))).toHaveLength(1);
  });
  it("returns historical person-hours and material sell snapshots, rejecting invalid dates",async()=>{
    const date=new Date().toISOString().slice(0,10);
    const response=await request(app).get(`/reports/pricing-review?from=${date}&to=${date}`);
    expect(response.status,JSON.stringify(response.body)).toBe(200);
    expect(response.body.jobs.find((j:{id:number})=>j.id===job)).toMatchObject({recordedMinutes:60,materialSellAmount:15,totalAmount:40,hasOpenTimers:false});
    expect(response.body.budgetJson).toBeNull();
    expect((await request(app).get("/reports/pricing-review?from=2026-02-30&to=2026-03-01")).status).toBe(400);
  });
  it("creates one internal follow-up and alert, then stops on decline or expiry",async()=>{
    const rule={offsetDays:1,label:"Review unanswered estimate",channels:[],notifyAdmin:true,createTask:true};
    expect((await request(app).patch("/estimate-reminder-settings").send({enabled:true,rules:[{...rule,notifyAdmin:false,createTask:false}]})).status).toBe(400);
    expect((await request(app).patch("/estimate-reminder-settings").send({enabled:true,rules:[rule,rule]})).status).toBe(400);
    const estimate=(await db.insert(estimatesTable).values({tenantId:scope.tenant,customerId:customer,status:"sent",reminderAnchorAt:new Date(Date.now()-3*86400000)}).returning())[0];
    expect((await request(app).patch("/estimate-reminder-settings").send({enabled:true,rules:[rule]})).status).toBe(200);
    const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,scope.tenant));
    await processEstimateReminders(tenant);await processEstimateReminders(tenant);
    expect(await db.select().from(internalTasksTable).where(eq(internalTasksTable.tenantId,scope.tenant))).toHaveLength(1);
    expect(await db.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.tenantId,scope.tenant),eq(taskNotificationsTable.type,"document_followup")))).toHaveLength(1);
    await db.update(estimatesTable).set({status:"declined"}).where(eq(estimatesTable.id,estimate.id));
    await db.execute(sql`UPDATE tenants SET estimate_reminder_settings=${JSON.stringify({enabled:true,rules:[{...rule,offsetDays:2}]})}::jsonb WHERE id=${scope.tenant}`);
    await processEstimateReminders((await db.select().from(tenantsTable).where(eq(tenantsTable.id,scope.tenant)))[0]);
    await db.insert(estimatesTable).values({tenantId:scope.tenant,customerId:customer,status:"sent",expiresAt:new Date(Date.now()-86400000),reminderAnchorAt:new Date(Date.now()-3*86400000)});
    await processEstimateReminders(tenant);
    expect(await db.select().from(internalTasksTable).where(eq(internalTasksTable.tenantId,scope.tenant))).toHaveLength(1);
  });
  it("scopes portal payments and saves cards only with explicit checkout consent",async()=>{
    gateway.checkout.sessions.create.mockResolvedValue({url:"https://checkout.example.invalid/fixture"});
    gateway.paymentIntents.retrieve.mockResolvedValue({customer:"cus_qa",payment_method:"pm_qa"});
    gateway.paymentMethods.retrieve.mockResolvedValue({id:"pm_qa",customer:"cus_qa",card:{brand:"visa",last4:"4242",exp_year:2030,exp_month:11}});
    vi.stubEnv("STRIPE_WEBHOOK_SECRET","unit-test-only");
    const token=randomUUID();
    await db.insert(customerOtpSessionsTable).values({tenantId:scope.tenant,customerId:customer,email:"qa@example.invalid",otpHash:"fixture",sessionToken:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+3600000)});
    await db.update(customersTable).set({stripeCustomerId:"cus_qa"}).where(eq(customersTable.id,customer));
    const invoice=(await db.insert(invoicesTable).values({tenantId:scope.tenant,customerId:customer,invoiceNumber:"QA-PORTAL",status:"sent",subtotal:20,total:20}).returning())[0];
    const pay=async(saveCard:boolean)=>request(app).post(`/portal/invoices/${invoice.id}/pay-session`).set("x-portal-token",token).send({returnUrl:"https://example.invalid/portal/invoices",saveCard});
    const firstPay=await pay(false);expect(firstPay.status,JSON.stringify(firstPay.body)).toBe(200);
    expect(gateway.checkout.sessions.create.mock.calls.at(-1)![0].payment_intent_data.setup_future_usage).toBeUndefined();
    const deliver=async(saveCard:boolean)=>{
      gateway.webhooks.constructEvent.mockReturnValue({type:"checkout.session.completed",data:{object:{id:"cs_fixture",payment_status:"paid",payment_intent:"pi_qa",metadata:{invoiceId:String(invoice.id),tenantId:String(scope.tenant),saveCard:String(saveCard)}}}});
      return request(app).post("/portal/stripe-webhook").set("stripe-signature","fixture").send({});
    };
    expect((await deliver(false)).status).toBe(200);
    expect((await db.select().from(customersTable).where(eq(customersTable.id,customer)))[0].stripeDefaultPaymentMethodId).toBeNull();
    await db.update(invoicesTable).set({status:"sent"}).where(eq(invoicesTable.id,invoice.id));
    expect((await pay(true)).status).toBe(200);
    expect(gateway.checkout.sessions.create.mock.calls.at(-1)![0].payment_intent_data.setup_future_usage).toBe("off_session");
    expect((await deliver(true)).status).toBe(200);
    expect((await db.select().from(customersTable).where(eq(customersTable.id,customer)))[0].stripeDefaultPaymentMethodId).toBe("pm_qa");
    const paidAt=(await db.select().from(invoicesTable).where(eq(invoicesTable.id,invoice.id)))[0].paidAt;
    await deliver(true);
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,invoice.id)))[0].paidAt).toEqual(paidAt);
    const foreignCustomer=(await db.insert(customersTable).values({tenantId:otherTenant,name:"Foreign QA",email:"other@example.invalid",phone:""}).returning())[0];
    const foreign=(await db.insert(invoicesTable).values({tenantId:otherTenant,customerId:foreignCustomer.id,invoiceNumber:"QA-FOREIGN",status:"sent",subtotal:1,total:1}).returning())[0];
    expect((await request(app).post(`/portal/invoices/${foreign.id}/pay-session`).set("x-portal-token",token).send({returnUrl:"https://example.invalid",saveCard:false})).status).toBe(404);
  });
  it("creates a full draft with credit separately applied and returns the same invoice on retry",async()=>{
    await db.insert(customerCreditsTable).values({tenantId:scope.tenant,customerId:customer,amount:50,kind:"prepayment",reference:"QA received",requestId:randomUUID()});
    const created=await request(app).post(`/billing/coverage/jobs/${job}/invoice`).send({});
    expect(created.status,JSON.stringify(created.body)).toBe(200);expect(created.body.existing).toBe(false);
    const again=await request(app).post(`/billing/coverage/jobs/${job}/invoice`).send({});
    expect(again.body).toEqual({invoiceId:created.body.invoiceId,existing:true});
    const invoices=await db.select().from(invoicesTable).where(eq(invoicesTable.jobId,job));
    expect(invoices).toHaveLength(1);expect(invoices[0]).toMatchObject({status:"draft",subtotal:40,total:40,creditApplied:40});
    expect((await request(app).get("/billing/coverage")).body.jobs.some((j:{id:number})=>j.id===job)).toBe(false);
    const foreign=(await db.insert(jobsTable).values({tenantId:otherTenant,title:"Foreign job",scheduledAt:new Date(),status:"completed",completedAt:new Date(),totalAmount:10}).returning())[0].id;
    expect((await request(app).post(`/billing/coverage/jobs/${foreign}/invoice`).send({})).status).toBe(404);
  });
  it("changing customer prepayment from paid/overdue invoices leaves history alone and blocks unfunded scheduling",async()=>{
    for(const status of ["overdue","paid"]){
      const [invoice]=await db.insert(invoicesTable).values({tenantId:scope.tenant,customerId:customer,invoiceNumber:randomUUID(),status,total:100,subtotal:100}).returning();
      const changed=await request(app).patch(`/billing/payment-policy/customer/${customer}`).send({depositType:"percent",depositValue:25,requirePrepay:true,requireCard:false});
      expect(changed.status,JSON.stringify(changed.body)).toBe(200);
      expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,invoice.id)))[0]).toEqual(invoice);
    }
    await expect(paymentGuardedJobInsert(db).values({tenantId:scope.tenant,customerId:customer,title:"Unfunded future service",scheduledAt:new Date(),totalAmount:100}).returning()).rejects.toThrow(/prepayment/i);
    expect(await db.select().from(jobsTable).where(and(eq(jobsTable.tenantId,scope.tenant),eq(jobsTable.title,"Unfunded future service")))).toHaveLength(0);
  });

  it("never guesses a portal company and binds generic branding to verified sessions", async () => {
    const { createHash, randomUUID } = await import("node:crypto");
    const { staffSessionsTable } = await import("@workspace/db");
    const staffToken = randomUUID(), portalToken = randomUUID();
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    await db.insert(staffSessionsTable).values({ tenantId: scope.tenant, userId: scope.user, tokenHash: digest(staffToken), expiresAt: new Date(Date.now() + 300_000) });
    await db.insert(customerOtpSessionsTable).values({ tenantId: scope.tenant, customerId: customer, email: "qa-brand@example.invalid", otpHash: digest("fixture"), sessionToken: digest(portalToken), expiresAt: new Date(Date.now() + 300_000) });
    expect((await request(app).get("/portal/tenant-info")).status).toBe(404);
    expect((await request(app).get("/portal/tenant-info").set("x-tenant-id", "1")).status).toBe(404);
    expect((await request(app).get("/portal/tenant-info").set("x-staff-session", "forged")).status).toBe(404);
    const staffBrand = await request(app).get("/portal/tenant-info").set("x-staff-session", staffToken).set("x-tenant-id", "1");
    expect(staffBrand.status).toBe(200);
    expect(staffBrand.body.tenantId).toBe(scope.tenant);
    const portalBrand = await request(app).get("/portal/tenant-info").set("x-portal-token", portalToken).set("x-tenant-id", "1");
    expect(portalBrand.status).toBe(200);
    expect(portalBrand.body.tenantId).toBe(scope.tenant);
    expect((await request(app).get(`/portal/tenant-info?tenantId=${scope.tenant}junk`).set("x-staff-session", staffToken)).status).toBe(404);
    expect((await request(app).get("/portal/tenant-info?slug=missing-qa-business").set("x-staff-session", staffToken)).status).toBe(404);
    expect((await request(app).get(`/portal/tenant-info?tenantId=${scope.tenant}`)).body.tenantId).toBe(scope.tenant);
  });
});
