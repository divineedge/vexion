import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import express from "express";
import request from "supertest";
import {drizzle} from "drizzle-orm/node-postgres";
import {and,eq,inArray} from "drizzle-orm";
import {randomUUID,createHash} from "node:crypto";
import {Readable} from 'node:stream';

const scope=vi.hoisted(()=>({tenant:0,user:0,connection:null as any}));
const intakeStorage=vi.hoisted(()=>({save:vi.fn().mockResolvedValue('/objects/hr-documents/intake_fixture'),remove:vi.fn().mockResolvedValue(undefined),get:vi.fn()}));
vi.mock('../lib/hrFiles',async original=>{
 const actual=await original<typeof import('../lib/hrFiles')>();
 return {...actual,hrStorage:{saveHrDocument:intakeStorage.save,deleteObjectEntity:intakeStorage.remove,getObjectEntityFile:intakeStorage.get}};
});
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
import websiteIntake,{publicWebsiteIntakeRouter} from './websiteIntake';
import {installWebsiteIntakeSchema} from '../lib/websiteFlow';
import vendorRoutes from './vendors';
import {installVendorCategoriesSchema} from '../lib/vendorCategories';
import {websiteIntakeSubmissionsTable,hrSettingsTable,hrApplicationsTable} from '@workspace/db';
import {defaultWebsiteFlow} from '@workspace/api-client-react/website-flow';

describe("rollback-only pricing, inventory and invoice recovery",()=>{
  let client:any,serial=0,customer:number,item:number,warehouse:number,job:number,otherTenant:number;
  const app=express();
  app.set('trust proxy',1);
  app.use(express.json({verify:(req,_res,buffer)=>{(req as any).rawBody=buffer;}}),expenses,pricing,safety,policies,reminderSettings,portal,sharing,invoices,estimates,settings,kpis,websiteIntake,publicWebsiteIntakeRouter,vendorRoutes);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({error:error.message,cause:error.cause?.message}));
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
    await installWebsiteIntakeSchema();
    await installVendorCategoriesSchema();
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
    await db.execute(sql`INSERT INTO tenant_kpi_settings(tenant_id,settings) VALUES(${scope.tenant},${JSON.stringify({mainKpis:[],detailKpis:["cash"]})}::jsonb)
      ON CONFLICT(tenant_id) DO UPDATE SET settings=EXCLUDED.settings`);
    expect((await request(app).get("/settings/kpis")).body).toEqual({mainKpis:[],detailKpis:["cash"],defaultDateRange:"year_to_date"});
    const choice={mainKpis:["customer_spend","cash"],detailKpis:["customer_spend","cash","efficiency"],defaultDateRange:"custom",customFrom:"2025-01-01",customTo:"2026-10-14"};
    expect((await request(app).patch("/settings/kpis").send(choice)).status).toBe(200);
    expect((await request(app).get("/settings/kpis")).body).toEqual(choice);
    expect((await request(app).patch("/settings/kpis").send({mainKpis:["cash"],detailKpis:[]})).status).toBe(400);
    expect((await request(app).patch("/settings/kpis").send({...choice,customFrom:"2026-02-30"})).status).toBe(400);
    expect((await request(app).patch("/settings/kpis").send({...choice,customFrom:"2027-01-01"})).status).toBe(400);
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
  it("holds website inquiries outside CRM, separates draft/published flows, and approves exactly once",async()=>{
    await db.execute(sql`UPDATE tenants SET acquisition_settings='{"quoteWidgetEnabled":true}'::jsonb WHERE id=${scope.tenant}`);
    const [service]=await db.insert(servicesTable).values({tenantId:scope.tenant,name:"Website QA service",basePrice:100,pricingMode:"flat"}).returning();
    const startCustomers=(await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length;
    const flow=defaultWebsiteFlow('quote');flow.title='Public quote before edit';flow.steps.at(-1)!.allowApproximate=true;flow.steps.at(-1)!.approximateTerms='Size is approximate; confirm pricing after verification.';
    flow.steps[0].questions.push({id:'gate',label:'Is there a locked gate?',type:'select',required:true,options:['Yes','No']},{id:'gateCode',label:'Gate code',type:'text',required:true,options:[],condition:{field:'gate',operator:'equals',value:'Yes'}});
    expect((await request(app).put('/website-intake/forms/quote').send({definition:flow,revision:0,publish:false})).status).toBe(200);
    expect((await request(app).get(`/public-intake/config?kind=quote&tenantId=${scope.tenant}`)).body.definition.title).not.toBe(flow.title);
    expect((await request(app).put('/website-intake/forms/quote').send({definition:flow,revision:1,publish:true})).status).toBe(200);
    expect((await request(app).put('/website-intake/forms/quote').send({definition:flow,revision:1,publish:true})).status).toBe(409);
    const config=(await request(app).get(`/public-intake/config?kind=quote&tenantId=${scope.tenant}`)).body;
    const body={tenantId:scope.tenant,kind:'quote',requestId:randomUUID(),revision:config.revision,consent:true,answers:{name:'Website QA',email:'website@example.invalid',serviceIds:[String(service.id)],address:'1 Main',city:'Denver',state:'CO',zip:'80000',lat:40.12,lng:-105.12,pinConfirmed:true,gate:'No',gateCode:'must be dropped'},measurements:{measure:{mode:'area',points:[],manual:1000,acceptedTerms:true}}};
    const first=await request(app).post('/public-intake/submit').send(body);expect(first.status,JSON.stringify(first.body)).toBe(201);
    expect(first.body.preview.total).toBe(100);
    expect((await request(app).post('/public-intake/submit').send(body)).body.reference).toBe(first.body.reference);
    expect((await request(app).post('/public-intake/submit').send({...body,answers:{...body.answers,name:'Changed'}})).status).toBe(409);
    expect((await request(app).post('/public-intake/submit').send({...body,requestId:randomUUID(),answers:{...body.answers,gate:'Yes',gateCode:''}})).status).toBe(400);
    expect((await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length).toBe(startCustomers);
    const inbox=(await request(app).get('/website-intake/submissions?kind=quote')).body;
    const item=inbox.submissions.find((s:any)=>s.payload.answers.name==='Website QA');
    expect(item.payload.answers.gateCode).toBeUndefined();expect(item.snapshot.title).toBe(flow.title);
    await db.update(servicesTable).set({basePrice:200}).where(eq(servicesTable.id,service.id));
    const approval=await request(app).post(`/website-intake/submissions/${item.id}/review`).send({action:'approve',createEstimate:true,customer:{name:'',phone:'3035550123'}});
    expect(approval.status,JSON.stringify(approval.body)).toBe(200);expect(approval.body.estimateId).toBeTruthy();
    expect((await request(app).post(`/website-intake/submissions/${item.id}/review`).send({action:'approve',createEstimate:true})).body.customerId).toBe(approval.body.customerId);
    expect((await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length).toBe(startCustomers+1);
    const [property]=await db.select().from(propertiesTable).where(eq(propertiesTable.id,approval.body.propertyId));expect(property.lat).toBe(40.12);
    const [estimate]=await db.select().from(estimatesTable).where(eq(estimatesTable.id,approval.body.estimateId));expect(estimate.status).toBe('draft');expect(estimate.total).toBe(100);
    const noMeasure=await request(app).post('/public-intake/submit').send({...body,requestId:randomUUID(),measurements:{}});expect(noMeasure.body.preview).toBeNull();
    const [held]=await db.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.reference,noMeasure.body.reference));
    const failed=await request(app).post(`/website-intake/submissions/${held.id}/review`).send({action:'approve',createEstimate:true});expect(failed.status).toBe(400);
    expect((await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length).toBe(startCustomers+1);
    expect((await request(app).post(`/website-intake/submissions/${held.id}/review`).send({action:'approve',createEstimate:true,areaSqft:1000})).status).toBe(200);
    const currentTenant=scope.tenant;scope.tenant=otherTenant;
    expect((await request(app).post(`/website-intake/submissions/${held.id}/review`).send({action:'approve'})).status).toBe(404);scope.tenant=currentTenant;
  });
  it("keeps website hiring private and creates no employee or customer before a human hiring decision",async()=>{
    await db.insert(hrSettingsTable).values({tenantId:scope.tenant,publicHiringEnabled:true,applicationFields:[],privacyNotice:'Hiring contact consent'}).onConflictDoUpdate({target:hrSettingsTable.tenantId,set:{publicHiringEnabled:true}});
    const beforeUsers=(await db.select().from(usersTable).where(eq(usersTable.tenantId,scope.tenant))).length;
    const beforeCustomers=(await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length;
    const config=(await request(app).get(`/public-intake/config?kind=hiring&tenantId=${scope.tenant}`)).body;
    const response=await request(app).post('/public-intake/submit').send({tenantId:scope.tenant,kind:'hiring',requestId:randomUUID(),revision:config.revision,consent:true,answers:{name:'New applicant',email:'applicant@example.invalid'},measurements:{}});
    expect(response.status,JSON.stringify(response.body)).toBe(201);
    expect((await db.select().from(usersTable).where(eq(usersTable.tenantId,scope.tenant))).length).toBe(beforeUsers);
    expect((await db.select().from(customersTable).where(eq(customersTable.tenantId,scope.tenant))).length).toBe(beforeCustomers);
    const inbox=(await request(app).get('/website-intake/submissions?kind=hiring')).body;
    const received=inbox.submissions.find((s:any)=>s.payload.answers.name==='New applicant');expect(received.applicationId).toBeTruthy();
    const [application]=await db.select().from(hrApplicationsTable).where(eq(hrApplicationsTable.id,received.applicationId));expect(application.userId).toBeNull();
    const owner=scope.user;const [manager]=await db.insert(usersTable).values({tenantId:scope.tenant,name:'Non-HR office manager',email:`${randomUUID()}@example.invalid`,role:'office_manager'}).returning();scope.user=manager.id;
    expect((await request(app).get('/website-intake/submissions?kind=hiring')).status).toBe(403);
    expect((await request(app).get('/website-intake/forms/hiring')).status).toBe(403);scope.user=owner;
    await db.update(usersTable).set({role:'technician'}).where(eq(usersTable.id,manager.id));
  });
  it('retains immutable published form history and restores only the draft with tenant and role checks',async()=>{
    for(const kind of ['quote','hiring'] as const){
      const url=`/website-intake/forms/${kind}`;
      const current=(await request(app).get(url)).body;
      const first=defaultWebsiteFlow(kind);first.title=`Historical ${kind}`;
      first.steps[0].questions.push({id:'historyGate',label:'Show details?',type:'select',options:['Yes','No'],required:true},
        {id:'historyDetails',label:'Required details',type:'text',options:[],required:true,condition:{field:'historyGate',operator:'equals',value:'Yes'}});
      expect((await request(app).put(url).send({definition:first,revision:current.revision,publish:true})).status).toBe(200);
      const second={...first,title:`Latest ${kind}`};
      const published=await request(app).put(url).send({definition:second,revision:current.revision+1,publish:true});
      expect(published.status).toBe(200);
      const history=(await request(app).get(`${url}/history`)).body;
      expect(history.versions[0].publisherName).toBe('QA owner');
      expect(history.versions[0].publishedBy).toBe(scope.user);
      expect(history.versions[0].publishedAt).toBeTruthy();
      const old=history.versions[1];expect(old.definition).toEqual(first);
      expect((await request(app).get(`${url}/history?before=${history.versions[0].id}`)).body.versions[0]).toEqual(old);
      const snapshots=await db.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.tenantId,scope.tenant));
      expect((await request(app).post(`${url}/history/${old.id}/restore`).send({revision:current.revision})).status).toBe(409);
      const restored=await request(app).post(`${url}/history/${old.id}/restore`).send({revision:published.body.revision});
      expect(restored.status,JSON.stringify(restored.body)).toBe(200);
      expect(restored.body.definition).toEqual(first);expect(restored.body.published).toEqual(second);
      const publicUrl=`/public-intake/config?kind=${kind}&tenantId=${scope.tenant}`;
      const liveAfterRestore=await request(app).get(publicUrl);
      expect(liveAfterRestore.status).toBe(200);expect(liveAfterRestore.body.definition).toEqual(second);
      expect(restored.body.revision).toBe(published.body.revision+1);
      expect((await request(app).get(url)).body).toEqual(restored.body);
      expect((await request(app).get(`${url}/history`)).body).toEqual(history);
      expect(await db.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.tenantId,scope.tenant))).toEqual(snapshots);
      const tenant=scope.tenant;scope.tenant=otherTenant;
      // Use an owner in the other company to test tenant scoping, not just permissions.
      const user=scope.user;const [otherOwner]=await db.insert(usersTable).values({tenantId:otherTenant,name:'Other owner',email:`${randomUUID()}@example.invalid`,role:'company_owner'}).returning();
      scope.user=otherOwner.id;
      expect((await request(app).get(`${url}/history`)).body.versions).toEqual([]);
      expect((await request(app).post(`${url}/history/${old.id}/restore`).send({revision:0})).status).toBe(404);
      scope.tenant=tenant;scope.user=user;
      const [restricted]=await db.insert(usersTable).values({tenantId:tenant,name:'Restricted history user',email:`${randomUUID()}@example.invalid`,role:kind==='hiring'?'office_manager':'technician'}).returning();
      scope.user=restricted.id;
      expect((await request(app).get(`${url}/history`)).status).toBe(403);
      expect((await request(app).post(`${url}/history/${old.id}/restore`).send({revision:restored.body.revision})).status).toBe(403);
      scope.user=user;
      await db.update(usersTable).set({isActive:false}).where(eq(usersTable.id,restricted.id));
      const republished=await request(app).put(url).send({definition:restored.body.definition,revision:restored.body.revision,publish:true});
      expect(republished.status).toBe(200);expect(republished.body.published).toEqual(first);
      expect((await request(app).get(publicUrl)).body.definition).toEqual(first);
      const latest=(await request(app).get(`${url}/history`)).body;
      expect(latest.versions.length).toBe(history.versions.length+1);
      expect(latest.versions[1]).toEqual(history.versions[0]);
    }
  });
  it('preserves existing live forms once without inventing legacy publication metadata',async()=>{
    const flow=defaultWebsiteFlow('quote');
    await db.execute(sql`INSERT INTO website_intake_forms(tenant_id,kind,draft,published,revision,updated_by) VALUES(${otherTenant},'quote',${JSON.stringify({...flow,title:'Unpublished edit'})}::jsonb,${JSON.stringify(flow)}::jsonb,7,${scope.user})`);
    await installWebsiteIntakeSchema();await installWebsiteIntakeSchema();
    const result=await db.execute(sql`SELECT * FROM website_intake_versions WHERE tenant_id=${otherTenant} AND kind='quote'`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({definition:flow,legacy:1,publisher_name:null,published_by:null,published_at:null});
  });
  it('saves vendor contacts and custom categories, defaults expenses from vendors, and keeps rename history and tenant boundaries',async()=>{
    await client.query('SAVEPOINT vendor_category_fixture');
    const originalTenant=scope.tenant,originalUser=scope.user;
    try{
      const categories=await request(app).get('/expense-categories');expect(categories.status).toBe(200);expect(categories.body.some((c:any)=>c.key==='fuel')).toBe(true);
      expect((await request(app).post('/expense-categories').send({name:'  '})).status).toBe(400);
      const added=await request(app).post('/expense-categories').send({name:'Specialty parts'});expect(added.status,JSON.stringify(added.body)).toBe(201);
      const key=added.body.key;
      expect((await request(app).post('/expense-categories').send({name:'SPECIALTY PARTS'})).status).toBe(409);
      const created=await request(app).post('/vendors').send({name:'QA vendor',category:key,contactName:'QA contact',officePhone:'303-555-0123',contact:'qa@example.invalid',notes:'Keep this'});
      expect(created.status,JSON.stringify(created.body)).toBe(201);expect(created.body.contactName).toBe('QA contact');expect(created.body.officePhone).toBe('303-555-0123');
      const get=await request(app).get(`/vendors/${created.body.id}`);expect(get.body.contact).toBe('qa@example.invalid');
      const payload={vendorId:created.body.id,date:'2026-10-15',amount:42,requestId:randomUUID()};
      const expense=await request(app).post('/expenses').send(payload);expect(expense.status,JSON.stringify(expense.body)).toBe(201);expect(expense.body.category).toBe(key);
      expect((await request(app).post('/expenses').send(payload)).body.id).toBe(expense.body.id);
      expect((await request(app).post('/expenses').send({...payload,category:'other'})).status).toBe(409);
      expect((await request(app).post('/expenses').send({...payload,requestId:randomUUID(),category:'fuel'})).body.category).toBe('fuel');
      expect((await request(app).patch(`/expense-categories/${key}`).send({name:'Repair parts'})).status).toBe(200);
      expect((await request(app).get('/expense-categories')).body.find((c:any)=>c.key===key).name).toBe('Repair parts');
      expect((await request(app).get(`/vendors/${created.body.id}`)).body.category).toBe(key);
      expect((await request(app).get(`/expenses/${expense.body.id}`)).body.category).toBe(key);
      const cleared=await request(app).patch(`/vendors/${created.body.id}`).send({contactName:'',officePhone:''});expect(cleared.status).toBe(200);expect(cleared.body.officePhone).toBe('');expect(cleared.body.contact).toBe('qa@example.invalid');
      expect((await request(app).patch(`/vendors/${created.body.id}`).send({})).status).toBe(400);
      const [otherOwner]=await db.insert(usersTable).values({tenantId:otherTenant,name:'Other owner',email:`${randomUUID()}@example.invalid`,role:'company_owner'}).returning();
      scope.tenant=otherTenant;scope.user=otherOwner.id;
      expect((await request(app).get('/expense-categories')).body.some((c:any)=>c.key===key)).toBe(false);
      expect((await request(app).patch(`/expense-categories/${key}`).send({name:'Forbidden'})).status).toBe(404);
      expect((await request(app).post('/vendors').send({name:'Other vendor',category:key})).status).toBe(400);
      expect((await request(app).get(`/vendors/${created.body.id}`)).status).toBe(404);
      await db.update(usersTable).set({role:'technician'}).where(eq(usersTable.id,otherOwner.id));
      expect((await request(app).post('/expense-categories').send({name:'Denied'})).status).toBe(403);
    }finally{scope.tenant=originalTenant;scope.user=originalUser;await client.query('ROLLBACK TO SAVEPOINT vendor_category_fixture');await client.query('RELEASE SAVEPOINT vendor_category_fixture');}
  });
  it('enforces offered services and private company-controlled JPEG/PDF uploads without creating CRM records',async()=>{
    await client.query('SAVEPOINT website_attachment_fixture');
    const owner=scope.user;
    const post=()=>request(app).post('/public-intake/submit').set('X-Forwarded-For','198.51.100.23');
    try{
      const [offered]=await db.insert(servicesTable).values({tenantId:scope.tenant,name:'Offered service',basePrice:75}).returning();
      const [excluded]=await db.insert(servicesTable).values({tenantId:scope.tenant,name:'Not offered',basePrice:99}).returning();
      const flow=defaultWebsiteFlow('quote');flow.uploads={enabled:true,required:true,label:'Property photos or documents'};
      const picker=flow.steps.flatMap(s=>s.questions).find(q=>q.id==='serviceIds')!;picker.type='select';picker.options=[String(offered.id)];
      const old=(await request(app).get('/website-intake/forms/quote')).body;
      const saved=await request(app).put('/website-intake/forms/quote').send({definition:flow,revision:old.revision,publish:true});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
      const config=(await request(app).get(`/public-intake/config?kind=quote&tenantId=${scope.tenant}`)).body;
      expect(config.services.map((s:any)=>s.id)).toEqual([offered.id]);
      const body={tenantId:scope.tenant,kind:'quote',requestId:randomUUID(),revision:config.revision,consent:true,answers:{name:'Attachment QA',email:'files@example.invalid',serviceIds:String(offered.id),address:'1 Main',city:'Denver',state:'CO',zip:'80000'},measurements:{}};
      expect((await post().send(body)).status).toBe(400);
      const pdf=Buffer.from('%PDF-1.4 fixture'),saveCount=intakeStorage.save.mock.calls.length;
      const received=await post().field('submission',JSON.stringify(body)).attach('files',pdf,'property.pdf');
      expect(received.status,JSON.stringify(received.body)).toBe(201);
      expect(received.body.attachments).toBeUndefined();expect(intakeStorage.save.mock.calls.length).toBe(saveCount+1);
      const repeat=await post().field('submission',JSON.stringify(body)).attach('files',pdf,'property.pdf');
      expect(repeat.body.reference).toBe(received.body.reference);expect(intakeStorage.save.mock.calls.length).toBe(saveCount+1);
      const inbox=(await request(app).get('/website-intake/submissions?kind=quote')).body;
      const entry=inbox.submissions.find((s:any)=>s.payload.answers.name==='Attachment QA');
      expect(entry.customerId).toBeNull();expect(entry.estimateId).toBeNull();expect(entry.payload.attachments[0].objectPath).toBeUndefined();
      expect(entry.payload.attachments[0].fileName).toBe('property.pdf');
      intakeStorage.get.mockImplementation(async()=>({createReadStream:()=>Readable.from([pdf])}));
      const download=await request(app).get(`/website-intake/submissions/${entry.id}/files/${entry.payload.attachments[0].id}`);
      expect(download.status).toBe(200);expect(download.headers['content-disposition']).toContain('attachment');expect(download.headers['cache-control']).toContain('no-store');
      const notOffered=await post().field('submission',JSON.stringify({...body,requestId:randomUUID(),answers:{...body.answers,serviceIds:String(excluded.id)}})).attach('files',pdf,'property.pdf');
      expect(notOffered.status).toBe(400);
      const badType=await post().field('submission',JSON.stringify({...body,requestId:randomUUID()})).attach('files',Buffer.from('<svg/>'),'photo.jpg');
      expect(badType.status).toBe(400);
      const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
      expect((await post().field('submission',JSON.stringify({...body,requestId:randomUUID()})).attach('files',png,'photo.png')).status).toBe(400);
      const removeCount=intakeStorage.remove.mock.calls.length;
      intakeStorage.save.mockResolvedValueOnce('/objects/hr-documents/rollback_fixture').mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
      const interrupted=await post().field('submission',JSON.stringify({...body,requestId:randomUUID()})).attach('files',pdf,'one.pdf').attach('files',pdf,'two.pdf');
      expect(interrupted.status).toBe(500);expect(intakeStorage.remove.mock.calls.length).toBe(removeCount+1);
      const hiring=defaultWebsiteFlow('hiring');hiring.uploads={enabled:true,required:false,label:'Application supporting documents'};
      const previous=(await request(app).get('/website-intake/forms/hiring')).body;
      expect((await request(app).put('/website-intake/forms/hiring').send({definition:hiring,revision:previous.revision,publish:true})).status).toBe(200);
      const hiringConfig=(await request(app).get(`/public-intake/config?kind=hiring&tenantId=${scope.tenant}`)).body;
      const application=await post().field('submission',JSON.stringify({tenantId:scope.tenant,kind:'hiring',requestId:randomUUID(),revision:hiringConfig.revision,consent:true,answers:{name:'Applicant with documents',email:'applicant-files@example.invalid'},measurements:{}})).attach('files',pdf,'certificate.pdf');
      expect(application.status,JSON.stringify(application.body)).toBe(201);
      const hiringInbox=(await request(app).get('/website-intake/submissions?kind=hiring')).body;
      const hiringEntry=hiringInbox.submissions.find((s:any)=>s.payload.answers.name==='Applicant with documents');
      expect(hiringEntry.applicationId).toBeTruthy();expect(hiringEntry.payload.attachments[0].objectPath).toBeUndefined();
      expect((await request(app).get(`/website-intake/submissions/${hiringEntry.id}/files/${hiringEntry.payload.attachments[0].id}`)).status).toBe(200);
      const [manager]=await db.insert(usersTable).values({tenantId:scope.tenant,name:'Non-HR file test',email:`${randomUUID()}@example.invalid`,role:'office_manager'}).returning();scope.user=manager.id;
      expect((await request(app).get(`/website-intake/submissions/${hiringEntry.id}/files/${hiringEntry.payload.attachments[0].id}`)).status).toBe(403);scope.user=owner;
      flow.uploads={enabled:false,required:false,label:'Property attachments'};
      expect((await request(app).put('/website-intake/forms/quote').send({definition:flow,revision:saved.body.revision,publish:true})).status).toBe(200);
      const disabled=(await request(app).get(`/public-intake/config?kind=quote&tenantId=${scope.tenant}`)).body;
      expect((await post().field('submission',JSON.stringify({...body,requestId:randomUUID(),revision:disabled.revision})).attach('files',pdf,'not-enabled.pdf')).status).toBe(400);
      const [nonHr]=await db.insert(usersTable).values({tenantId:scope.tenant,name:'Private credential test',email:`${randomUUID()}@example.invalid`,role:'technician'}).returning();scope.user=nonHr.id;
      expect((await request(app).get(`/website-intake/submissions/${entry.id}/files/${entry.payload.attachments[0].id}`)).status).toBe(403);
    }finally{scope.user=owner;await client.query('ROLLBACK TO SAVEPOINT website_attachment_fixture');await client.query('RELEASE SAVEPOINT website_attachment_fixture');}
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
