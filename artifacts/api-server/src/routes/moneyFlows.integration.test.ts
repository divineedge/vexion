import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import express from "express";
import request from "supertest";
import {drizzle} from "drizzle-orm/node-postgres";
import {and,eq,inArray} from "drizzle-orm";
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
import sharing from "./documentSharing";
import invoices from "./invoices";
import estimates from "./estimates";
import settings from "./settings";
import kpis from "./kpis";
import { installKpiSchema } from "../lib/kpiSettings";
import { propertiesTable, servicesTable } from "@workspace/db";
import { recurringInvoiceTemplatesTable } from "@workspace/db";
import { generateDueTemplate } from "../lib/billingScheduler";

describe("rollback-only pricing, inventory and invoice recovery",()=>{
  let client:any,serial=0,customer:number,item:number,warehouse:number,job:number,otherTenant:number;
  const app=express();
  app.use(express.json({verify:(req,_res,buffer)=>{(req as any).rawBody=buffer;}}),expenses,pricing,safety,policies,reminderSettings,portal,sharing,invoices,estimates,settings,kpis);
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
    await installKpiSchema();
    scope.tenant=(await db.insert(tenantsTable).values({name:"Rollback money QA",timezone:"UTC",taxRate:0}).returning())[0].id;
    otherTenant=(await db.insert(tenantsTable).values({name:"Rollback other QA",timezone:"UTC"}).returning())[0].id;
    scope.user=(await db.insert(usersTable).values({tenantId:scope.tenant,name:"QA owner",email:`${randomUUID()}@example.invalid`,role:"company_owner"}).returning())[0].id;
    customer=(await db.insert(customersTable).values({tenantId:scope.tenant,name:"QA customer",email:"qa@example.invalid",phone:""}).returning())[0].id;
    warehouse=(await db.insert(inventoryLocationsTable).values({tenantId:scope.tenant,name:"QA warehouse",type:"warehouse"}).returning())[0].id;
    item=(await db.insert(inventoryItemsTable).values({tenantId:scope.tenant,name:"QA supplies",sku:"QA-ONE",quantity:10,unitPrice:10,markedUpPrice:15}).returning())[0].id;
    job=(await db.insert(jobsTable).values({tenantId:scope.tenant,customerId:customer,title:"QA completed job",status:"completed",scheduledAt:new Date(),completedAt:new Date(),totalAmount:40,jobParts:[{total:15}]}).returning())[0].id;
    await db.insert(subTimersTable).values({tenantId:scope.tenant,userId:scope.user,type:"job",label:"QA work",jobId:job,elapsedSeconds:3600,isActive:false,stoppedAt:new Date()});
  });
  it("persists division service links and minimums for pricing review, rejecting foreign and duplicate assignments", async()=>{
    const originalBudget=(await request(app).get("/settings/budget")).body.budgetData;
    const service=(await db.insert(servicesTable).values({tenantId:scope.tenant,name:"Budget-linked service"}).returning())[0];
    const foreign=(await db.insert(servicesTable).values({tenantId:otherTenant,name:"Foreign budget service"}).returning())[0];
    const budgetData=[{year:2026,divisions:[{id:"budget-lawn",name:"Lawn",serviceIds:[service.id],minimumVisitHours:1.5}],overheadOverrides:{fuelMaintenance:500}}];
    expect((await request(app).patch("/settings/budget").send({budgetData})).status).toBe(200);
    const saved=await request(app).get("/settings/budget");
    expect(saved.body.budgetData).toEqual(budgetData);
    const report=await request(app).get("/reports/pricing-review?from=2026-01-01&to=2026-12-31");
    expect(report.status).toBe(200);
    expect(JSON.parse(report.body.budgetJson)).toEqual(budgetData);
    const bad=[{...budgetData[0],divisions:[{...budgetData[0].divisions[0],serviceIds:[foreign.id]}]}];
    expect((await request(app).patch("/settings/budget").send({budgetData:bad})).status).toBe(400);
    const duplicate=[{...budgetData[0],divisions:[...budgetData[0].divisions,{id:"second",serviceIds:[service.id]}]}];
    expect((await request(app).patch("/settings/budget").send({budgetData:duplicate})).status).toBe(400);
    expect((await request(app).get("/settings/budget")).body.budgetData).toEqual(budgetData);
    await db.execute(sql`UPDATE tenants SET budget_data=${originalBudget == null ? null : JSON.stringify(originalBudget)}::jsonb WHERE id=${scope.tenant}`);
  });
  it("persists KPI selections per company, validates selections, and returns tenant-owned report sources",async()=>{
    const choice={mainKpis:["customer_spend","cash"],detailKpis:["customer_spend","cash","efficiency"]};
    expect((await request(app).patch("/settings/kpis").send(choice)).status).toBe(200);
    expect((await request(app).get("/settings/kpis")).body).toEqual(choice);
    expect((await request(app).patch("/settings/kpis").send({mainKpis:["cash"],detailKpis:[]})).status).toBe(400);
    expect((await request(app).get("/settings/kpis")).body).toEqual(choice);
    const report=await request(app).get("/dashboard/kpis?from=2026-01-01&to=2026-12-31");
    expect(report.status,JSON.stringify(report.body)).toBe(200);
    expect(report.body.jobs.some((j:{id:number})=>j.id===job)).toBe(true);
    expect(report.body.jobs.every((j:{customerId:number})=>j.customerId===customer)).toBe(true);
    expect((await request(app).get("/dashboard/kpis?from=2026-02-30&to=2026-12-31")).status).toBe(400);
    const ownerUser=scope.user;
    const tech=(await db.insert(usersTable).values({tenantId:scope.tenant,name:"KPI technician",role:"technician",email:`${randomUUID()}@example.invalid`}).returning())[0];
    scope.user=tech.id;
    expect((await request(app).get("/settings/kpis")).status).toBe(403);
    expect((await request(app).get("/dashboard/kpis?from=2026-01-01&to=2026-12-31")).status).toBe(403);
    scope.user=ownerUser;
    const manager=(await db.insert(usersTable).values({tenantId:scope.tenant,name:"KPI office manager",role:"office_manager",email:`${randomUUID()}@example.invalid`}).returning())[0];
    await db.update(tenantsTable).set({rolePermissions:{office_manager:{"financials.costData":false}}}).where(eq(tenantsTable.id,scope.tenant));
    scope.user=manager.id;
    expect((await request(app).get("/dashboard/kpis?from=2026-01-01&to=2026-12-31")).status).toBe(403);
    scope.user=ownerUser;
    await db.update(tenantsTable).set({rolePermissions:{}}).where(eq(tenantsTable.id,scope.tenant));
    // Keep later notification fixtures' single-office-recipient assumption intact.
    await db.update(usersTable).set({role:"technician"}).where(eq(usersTable.id,manager.id));
    const originalTenant=scope.tenant;
    const otherOwner=(await db.insert(usersTable).values({tenantId:otherTenant,name:"Other KPI owner",role:"company_owner",email:`${randomUUID()}@example.invalid`}).returning())[0];
    scope.tenant=otherTenant;scope.user=otherOwner.id;
    expect((await request(app).get("/settings/kpis")).body.mainKpis).toContain("revenue_hour");
    scope.tenant=originalTenant;scope.user=ownerUser;
    expect((await request(app).get("/settings/kpis")).body).toEqual(choice);
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
  it("publishes stable estimate links without email and lists the right customer's documents", async () => {
    const [c] = await db.insert(customersTable).values({tenantId:scope.tenant,name:"Share QA",email:"share@example.invalid",phone:"5550101"}).returning();
    const [e] = await db.insert(estimatesTable).values({tenantId:scope.tenant,customerId:c.id,status:"draft",subtotal:100,total:100,lineItems:[]}).returning();
    const token = randomUUID();
    await db.insert(customerOtpSessionsTable).values({tenantId:scope.tenant,customerId:c.id,email:c.email!,otpHash:"fixture",sessionToken:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+300000)});
    const before = await request(app).get("/portal/estimates").set("x-portal-token",token);
    expect(before.body.some((row:any)=>row.id===e.id)).toBe(false);
    expect((await request(app).get(`/estimates/${e.id}/share-link`)).body.publicLink).toBeNull();
    const generated = await request(app).post(`/estimates/${e.id}/share-link`).send({});
    expect(generated.status).toBe(200);
    expect(generated.body.publicLink).toMatch(/^https:\/\/.*\/estimate\/[a-f0-9]+$/);
    const repeated = await request(app).post(`/estimates/${e.id}/share-link`).send({});
    expect(repeated.body.publicLink).toBe(generated.body.publicLink);
    const after = await request(app).get("/portal/estimates").set("x-portal-token",token);
    expect(after.body.some((row:any)=>row.id===e.id&&row.status==="sent")).toBe(true);
    const [invoice] = await db.insert(invoicesTable).values({tenantId:scope.tenant,customerId:c.id,invoiceNumber:randomUUID(),status:"draft",total:100,subtotal:100}).returning();
    const sharedInvoice = await request(app).post(`/invoices/${invoice.id}/share-link`);
    expect(sharedInvoice.status).toBe(200);
    expect(sharedInvoice.body.publicLink).toContain("/invoice/");
    expect((await request(app).get(`/invoices/${invoice.id}/share-link`)).body.publicLink).toBe(sharedInvoice.body.publicLink);
    const portalInvoices = await request(app).get("/portal/invoices").set("x-portal-token",token);
    expect(portalInvoices.body.some((row:any)=>row.id===invoice.id)).toBe(true);
    expect(portalInvoices.body.every((row:any)=>row.customerId===undefined||row.customerId===c.id)).toBe(true);
    const hidden = await request(app).get(`/portal/invoices/${(await db.insert(invoicesTable).values({tenantId:scope.tenant,customerId:customer,invoiceNumber:randomUUID(),total:10}).returning())[0].id}`).set("x-portal-token",token);
    expect(hidden.status).toBe(404);
  });

  it("matches ordered company rules at acceptance and preserves rules when defaults change", async () => {
    const [c] = await db.insert(customersTable).values({tenantId:scope.tenant,name:"Deposit QA",email:"deposit@example.invalid",phone:""}).returning();
    const [service] = await db.insert(servicesTable).values({tenantId:scope.tenant,name:"Deposit QA service",basePrice:600}).returning();
    const rules = [
      {id:randomUUID(),name:"Small",enabled:true,minTotal:0,maxTotal:500,serviceIds:[],serviceMatch:"any",depositType:"percent",depositValue:25},
      {id:randomUUID(),name:"Large service",enabled:true,minTotal:500,maxTotal:null,serviceIds:[service.id],serviceMatch:"all",depositType:"percent",depositValue:50},
    ];
    expect((await request(app).patch("/billing/deposit-rules").send({rules})).status).toBe(200);
    expect((await request(app).patch("/billing/payment-policy/company/0").send({depositType:"none",depositValue:null,requirePrepay:false,requireCard:false})).status).toBe(200);
    expect((await request(app).get("/billing/deposit-rules")).body.rules).toEqual(rules);
    expect((await request(app).patch("/billing/deposit-rules").send({rules:[{...rules[0],depositValue:101}]})).status).toBe(400);
    const approvalToken=randomUUID();
    const [e] = await db.insert(estimatesTable).values({tenantId:scope.tenant,customerId:c.id,status:"sent",approvalToken,total:600,subtotal:600,paymentRequirement:"none",
      lineItems:[{id:randomUUID(),description:"Work",qty:1,unitPrice:600,markup:0,discount:0,isOptional:false,serviceId:service.id}]}).returning();
    const view = await request(app).get(`/public/estimates/${approvalToken}`);
    expect(view.status).toBe(200);expect(view.body.paymentRequirement).toBe("deposit_pct");expect(view.body.depositValue).toBe(50);
    const approval = await request(app).post(`/public/estimates/${approvalToken}/respond`).send({action:"approve",acceptedOptionalItemIds:[]});
    expect([402,503]).toContain(approval.status);
    expect((await db.select().from(estimatesTable).where(eq(estimatesTable.id,e.id)))[0].status).toBe("sent");
    await db.update(customersTable).set({paymentPolicy:{depositType:"none",depositValue:null,requirePrepay:null,requireCard:null}}).where(eq(customersTable.id,c.id));
    expect((await request(app).get(`/public/estimates/${approvalToken}`)).body.paymentRequirement).toBe("none");
    await request(app).patch("/billing/deposit-rules").send({rules:[]});
  });

  it("combines or splits property work atomically and refuses jobs already invoiced", async () => {
    const make = async () => {
      const [c] = await db.insert(customersTable).values({tenantId:scope.tenant,name:"Property invoice QA",email:"properties@example.invalid",phone:""}).returning();
      const props = await db.insert(propertiesTable).values([{tenantId:scope.tenant,customerId:c.id,address:"10 QA Lane"},{tenantId:scope.tenant,customerId:c.id,address:"20 QA Lane"}]).returning();
      const work = await db.insert(jobsTable).values(props.map((p,index)=>({tenantId:scope.tenant,customerId:c.id,propertyId:p.id,title:`QA property ${index}`,status:"completed",scheduledAt:new Date(),completedAt:new Date(),totalAmount:100*(index+1)}))).returning();
      return {c,props,work,body:{customerId:c.id,jobIds:work.map(j=>j.id),lineItems:work.map(j=>({description:j.title,quantity:1,unitPrice:j.totalAmount,total:j.totalAmount,propertyId:j.propertyId,jobId:j.id}))}};
    };
    const combined=await make();
    const saved=await request(app).post("/invoices").send(combined.body);
    expect(saved.status).toBe(201);expect(saved.body.invoiceIds).toHaveLength(1);
    expect(saved.body.lineItems.map((line:any)=>line.propertyId)).toEqual(combined.props.map(p=>p.id));
    expect(saved.body.lineItems[0].description).toContain("10 QA Lane");
    expect((await request(app).post("/invoices").send(combined.body)).status).toBe(409);
    const split=await make();
    expect((await request(app).patch(`/billing/customer-invoice-grouping/${split.c.id}`).send({mode:"by_property"})).status).toBe(200);
    const separated=await request(app).post("/invoices").send(split.body);
    expect(separated.status).toBe(201);expect(separated.body.invoiceIds).toHaveLength(2);
    const linked=await db.select().from(jobsTable).where(inArray(jobsTable.id,split.work.map(j=>j.id)));
    expect(new Set(linked.map(j=>j.invoiceId)).size).toBe(2);
    const invalid=await request(app).post("/invoices").send({customerId:split.c.id,lineItems:[{description:"Wrong property",quantity:1,unitPrice:1,propertyId:combined.props[0].id}]});
    expect(invalid.status).toBe(409);
    const mixed = await make();
    const mixedSaved = await request(app).post("/invoices").send({customerId:mixed.c.id,jobIds:[mixed.work[0].id],lineItems:[
      mixed.body.lineItems[0],{description:"Manual work on the other property",quantity:1,unitPrice:50,propertyId:mixed.props[1].id},
    ]});
    expect(mixedSaved.status).toBe(201);
    expect(mixedSaved.body.lineItems.map((line:any)=>line.propertyId)).toEqual(mixed.props.map(property=>property.id));
  });

  it("splits completed-work recurring billing by property and retains the retry barrier", async () => {
    const [c]=await db.insert(customersTable).values({tenantId:scope.tenant,name:"Recurring properties QA",email:"recurring@example.invalid",phone:"",paymentPolicy:{invoiceGrouping:"by_property"}}).returning();
    const props=await db.insert(propertiesTable).values([{tenantId:scope.tenant,customerId:c.id,address:"30 QA Lane"},{tenantId:scope.tenant,customerId:c.id,address:"40 QA Lane"}]).returning();
    const work=await db.insert(jobsTable).values(props.map(property=>({tenantId:scope.tenant,customerId:c.id,propertyId:property.id,title:"Recurring QA",status:"completed",scheduledAt:new Date(),completedAt:new Date(),totalAmount:75}))).returning();
    const [template]=await db.insert(recurringInvoiceTemplatesTable).values({tenantId:scope.tenant,customerId:c.id,name:"Property grouping QA",billingMode:"completed_work",billingCycleType:"daily",nextBillingDate:"2020-01-01",createdAt:new Date("2020-01-01")}).returning();
    const ids=await db.transaction(tx=>generateDueTemplate(tx,template));
    expect(ids).toHaveLength(2);
    expect(new Set((await db.select().from(jobsTable).where(inArray(jobsTable.id,work.map(job=>job.id)))).map(job=>job.invoiceId)).size).toBe(2);
    expect(await db.transaction(tx=>generateDueTemplate(tx,template))).toHaveLength(0);
  });

  it("applies deposits from several jobs on one invoice and protects their allocation record from edits", async () => {
    const [c]=await db.insert(customersTable).values({tenantId:scope.tenant,name:"Multiple deposits QA",email:"multiple@example.invalid",phone:""}).returning();
    const quotes=await db.insert(estimatesTable).values([10,20].map(amount=>({tenantId:scope.tenant,customerId:c.id,status:"approved",total:100,depositPaidAt:new Date(),depositChargedAmount:amount}))).returning();
    const work=await db.insert(jobsTable).values(quotes.map(quote=>({tenantId:scope.tenant,customerId:c.id,estimateId:quote.id,title:"Deposit work",status:"completed",scheduledAt:new Date(),completedAt:new Date(),totalAmount:100}))).returning();
    const saved=await request(app).post("/invoices").send({customerId:c.id,jobIds:work.map(job=>job.id),lineItems:work.map(job=>({jobId:job.id,description:job.title,quantity:1,unitPrice:100}))});
    expect(saved.status).toBe(201);
    const [original]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,saved.body.id));
    expect(original.depositApplied).toBe(30);
    const edited=await request(app).patch(`/invoices/${original.id}`).send({lineItems:[{description:"Updated wording",quantity:1,unitPrice:200}]});
    expect(edited.status).toBe(409);
    const [updated]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,original.id));
    expect((updated.lineItems as any[])[0].depositAllocations).toEqual((original.lineItems as any[])[0].depositAllocations);
  });
});
