import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

// Real PostgreSQL, one rollback-only connection. No business/payroll fixtures persist.
const holder=vi.hoisted(()=>({connection:null as any,savepoint:0}));
// Session verification is an auth-module seam; active-user and tenant checks
// remain real, and the report/cost permission middleware is not mocked.
vi.mock("./auth",async importOriginal=>{
  const original=await importOriginal<typeof import("./auth")>();
  return {...original,resolveStaffSession:async(req:{verifiedTenantId?:number;verifiedUserId?:number})=>
    req.verifiedTenantId&&req.verifiedUserId?{tenantId:req.verifiedTenantId,userId:req.verifiedUserId}:null};
});
vi.mock("@workspace/db",async importOriginal=>{
  const original=await importOriginal<typeof import("@workspace/db")>();
  return {...original,db:new Proxy(original.db,{get(target,key){
    if(key==="transaction"&&holder.connection)return async(fn:any)=>{
      const name=`economics_${++holder.savepoint}`,connection=holder.connection;
      await connection.execute(sql.raw(`SAVEPOINT ${name}`));
      try {const result=await fn(connection);await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));return result;}
      catch(error){await connection.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));throw error;}
    };
    const current=holder.connection??target,value=current[key];
    return typeof value==="function"?value.bind(current):value;
  }})};
});
import { db,pool,tenantsTable,usersTable,servicesTable,jobsTable,customersTable,propertiesTable,
  inventoryItemsTable,payrollRatesTable,subTimersTable,estimatesTable,expenseEntriesTable } from "@workspace/db";
import { installJobEconomicsSchema } from "../lib/jobEconomicsSchema";
import router from "./jobEconomics";

describe.skipIf(!(process.env.DATABASE_URL||process.env.PGHOST))("recorded job economics",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>;
  let tenant:number,owner:number,tech:number,foreign:number,foreignOwner:number,customer:number,service:number,property:number,part:number,job:number;
  let costId:number,expense:number;
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{
    if(req.headers["x-unauth"]){next();return;}
    Object.assign(req,{verifiedTenantId:req.headers["x-foreign"]?foreign:tenant,
      verifiedUserId:req.headers["x-foreign"]?foreignOwner:req.headers["x-tech"]?tech:owner});next();
  });
  app.use("/api",router);
  app.use(((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({error:error.message,cause:error.cause?.message})) as express.ErrorRequestHandler);
  const report=(suffix="")=>request(app).get(`/api/reports/job-economics?from=2020-01-02&to=2020-01-02${suffix}`);
  const jobRequest=(body:object)=>request(app).post(`/api/reports/job-economics/${job}/costs`).send(body);
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    holder.connection=drizzle(client);
    await installJobEconomicsSchema();
    [tenant]=(await db.insert(tenantsTable).values({name:"Economics rollback fixture",timezone:"America/Denver",
      measurementZoneTypes:[{id:"lawn",name:"Lawn",mode:"area"}]}).returning()).map(r=>r.id);
    [foreign]=(await db.insert(tenantsTable).values({name:"Foreign economics fixture"}).returning()).map(r=>r.id);
    const addUser=async(tenantId:number,role:string,hourlyRate:number)=>(await db.insert(usersTable)
      .values({tenantId,role,name:role,email:`${role}-${tenantId}@economics.invalid`,hourlyRate}).returning())[0].id;
    owner=await addUser(tenant,"company_owner",10);tech=await addUser(tenant,"technician",20);foreignOwner=await addUser(foreign,"company_owner",10);
    await db.insert(payrollRatesTable).values([
      {tenantId:tenant,source:"hourly",sourceId:owner,value:10,effectiveAt:new Date("2020-01-01T00:00Z")},
      {tenantId:tenant,source:"hourly",sourceId:tech,value:20,effectiveAt:new Date("2020-01-01T00:00Z")},
      {tenantId:tenant,source:"hourly",sourceId:tech,value:30,effectiveAt:new Date("2020-01-02T12:00Z")},
    ]);
    [customer]=(await db.insert(customersTable).values({tenantId:tenant,name:"Economics customer",email:"economics@fixture.invalid",phone:"000"}).returning()).map(r=>r.id);
    [property]=(await db.insert(propertiesTable).values({tenantId:tenant,customerId:customer,address:"Rollback-only property",
      measurementPolygons:[{zoneTypeId:"lawn",areaSqft:2000,mode:"area"}]}).returning()).map(r=>r.id);
    [service]=(await db.insert(servicesTable).values({tenantId:tenant,name:"Lawn service",pricingMode:"matrix",linkedZoneTypeId:"lawn",
      pricingMatrix:[{minSqft:0,maxSqft:1000,price:100},{minSqft:1001,maxSqft:null,price:300}]}).returning()).map(r=>r.id);
    [part]=(await db.insert(inventoryItemsTable).values({tenantId:tenant,name:"Seed",sku:"economics-seed",unitPrice:5}).returning()).map(r=>r.id);
    [job]=(await db.insert(jobsTable).values({tenantId:tenant,customerId:customer,propertyId:property,serviceId:service,
      assigneeId:tech,title:"Economics fixture",status:"completed",totalAmount:300,estimatedDuration:120,
      scheduledAt:new Date("2020-01-01T10:00Z"),completedAt:new Date("2020-01-03T06:59Z"),createdAt:new Date("2020-01-02T10:00Z"),
      suppliesNeeded:[{inventoryItemId:part,name:"Seed",quantity:2,unit:"bag"}],
      jobParts:[{inventoryItemId:part,name:"Seed",quantity:2,unitPrice:100,total:200,costPrice:1,_stockUsage:{total:30}}],
    }).returning()).map(r=>r.id);
    await db.insert(subTimersTable).values([
      {tenantId:tenant,userId:tech,jobId:job,type:"job",label:"Work",startedAt:new Date("2020-01-02T10:00Z"),stoppedAt:new Date("2020-01-02T14:00Z"),elapsedSeconds:14400,isActive:false},
      {tenantId:tenant,userId:owner,jobId:job,type:"job",label:"Owner work",startedAt:new Date("2020-01-02T11:00Z"),stoppedAt:new Date("2020-01-02T12:00Z"),elapsedSeconds:3600,isActive:false},
    ]);
    [expense]=(await db.insert(expenseEntriesTable).values({tenantId:tenant,date:"2020-01-02",amount:20,category:"other",description:"Disposal"}).returning()).map(r=>r.id);
  });
  afterAll(async()=>{holder.connection=null;if(client){await client.query("ROLLBACK");client.release();}});

  it("includes owners, splits mid-timer rate changes and compares scheduling snapshots",async()=>{
    const result=await report();expect(result.status,JSON.stringify(result.body)).toBe(200);
    const row=result.body.jobs.find((j:any)=>j.id===job);
    expect(row).toMatchObject({minutes:300,laborCost:110,materialCost:30,totalCost:140,profit:160,revenue:300,
      completedDate:"2020-01-02",budgetRevenue:300,budgetMinutes:120,budgetMaterialCost:10,budgetLaborCost:40,
      measurement:2000,measurementSource:"snapshot",measurementUnit:"sqft"});
    expect(row.workers).toHaveLength(2);
    expect(row.materials[0]).toMatchObject({cost:30,unitCost:15,source:"Frozen stock usage"});
  });
  it("retains original tier, measurements and costs after catalog/property/rate edits",async()=>{
    await db.update(servicesTable).set({name:"New catalog name",pricingMatrix:[{minSqft:0,maxSqft:null,price:1}]}).where(eq(servicesTable.id,service));
    await db.update(propertiesTable).set({measurementPolygons:[{zoneTypeId:"lawn",areaSqft:9000}]}).where(eq(propertiesTable.id,property));
    await db.update(inventoryItemsTable).set({unitPrice:25}).where(eq(inventoryItemsTable.id,part));
    await db.update(usersTable).set({hourlyRate:100}).where(eq(usersTable.id,tech));
    const result=await report();
    const row=result.body.jobs.find((j:any)=>j.id===job);
    expect(row).toMatchObject({serviceName:"Lawn service",matrixLabel:"1,001–above sq ft",measurement:2000,budgetMaterialCost:10,budgetLaborCost:40,laborCost:110,materialCost:30});
  });
  it("filters by customer/service and never leaks another tenant or technician financial data",async()=>{
    expect((await report(`&customerId=${customer}&serviceId=${service}`)).body.jobs.map((j:any)=>j.id)).toContain(job);
    expect((await report("&serviceId=0")).body.jobs).toEqual([]);
    expect((await report().set("x-foreign","1")).body.jobs).toEqual([]);
    expect((await report().set("x-tech","1")).status).toBe(403);
    expect((await report().set("x-unauth","1")).status).toBe(401);
    expect((await report("&serviceId=-1")).status).toBe(400);
    expect((await request(app).get("/api/reports/job-economics?from=2020-02-30&to=2020-03-01")).status).toBe(400);
  });
  it("records additional costs once, caps expense allocations, and retains void audit",async()=>{
    const body={description:"Disposal",amount:12.5,requestId:"economics-request-once",expenseId:expense};
    const created=await jobRequest(body);expect(created.status,JSON.stringify(created.body)).toBe(201);
    costId=created.body.id;
    expect((await jobRequest(body)).body.id).toBe(costId);
    expect((await jobRequest({...body,amount:13})).status).toBe(409);
    expect((await jobRequest({...body,requestId:"economics-over-allocated",amount:10})).status).toBe(409);
    const row=(await report()).body.jobs.find((j:any)=>j.id===job);
    expect(row).toMatchObject({otherCost:12.5,profit:147.5});
    expect((await jobRequest({...body,requestId:"economics-foreign"}).set("x-foreign","1")).status).toBe(404);
    expect((await jobRequest({...body,requestId:"economics-tech"}).set("x-tech","1")).status).toBe(403);
    expect((await jobRequest({...body,requestId:"economics-precision",amount:1.001})).status).toBe(400);
    await client.query("SAVEPOINT expense_allocation_guard");
    await expect(client.query("UPDATE expense_entries SET amount=1 WHERE id=$1",[expense])).rejects.toThrow(/active job allocations/);
    await client.query("ROLLBACK TO SAVEPOINT expense_allocation_guard");
    const voided=await request(app).post(`/api/reports/job-economics/${job}/costs/${costId}/void`).send({reason:"Wrong job allocation"});
    expect(voided.status,JSON.stringify(voided.body)).toBe(200);
    const after=(await report()).body.jobs.find((j:any)=>j.id===job);
    expect(after.otherCost).toBe(0);expect(after.otherCosts[0].voidReason).toBe("Wrong job allocation");
    expect((await request(app).post(`/api/reports/job-economics/${job}/costs/${costId}/void`).send({reason:"Repeat"})).status).toBe(409);
  });
  it("prevents rewriting or deleting cost history even through direct SQL",async()=>{
    for(const query of [`DELETE FROM job_other_costs WHERE id=${costId}`,`UPDATE job_other_costs SET amount=1 WHERE id=${costId}`]){
      await client.query("SAVEPOINT protect_cost");
      await expect(client.query(query)).rejects.toThrow(/immutable|cannot be deleted/);
      await client.query("ROLLBACK TO SAVEPOINT protect_cost");
    }
  });
  it("uses adjusted time and exposes partial known cost without inventing a profit",async()=>{
    await client.query("SAVEPOINT adjusted_report");
    await db.execute(sql`UPDATE sub_timers SET adjusted_stopped_at='2020-01-02T13:00Z'
      WHERE job_id=${job} AND user_id=${tech} AND tenant_id=${tenant}`);
    let result=await report();
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.jobs.find((j:any)=>j.id===job)).toMatchObject({minutes:240,laborCost:80});
    await client.query("ROLLBACK TO SAVEPOINT adjusted_report");
    await client.query("SAVEPOINT partial_report");
    await db.insert(subTimersTable).values({tenantId:tenant,userId:tech,jobId:job,type:"job",label:"Earlier job work",
      startedAt:new Date("2019-12-31T23:00Z"),stoppedAt:new Date("2020-01-01T01:00Z"),elapsedSeconds:7200,isActive:false});
    result=await report();
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.jobs.find((j:any)=>j.id===job)).toMatchObject({minutes:420,laborCost:null,totalCost:null,profit:null,knownCost:160});
    await client.query("ROLLBACK TO SAVEPOINT partial_report");
  });
  it("does not assign one whole job's costs or measurement to several services",async()=>{
    const [second]=await db.insert(servicesTable).values({tenantId:tenant,name:"Second service"}).returning();
    const [mixed]=await db.insert(jobsTable).values({tenantId:tenant,customerId:customer,propertyId:property,serviceId:service,
      title:"Multiple-service fixture",status:"completed",totalAmount:200,scheduledAt:new Date("2020-01-02T10:00Z"),
      completedAt:new Date("2020-01-02T15:00Z"),lineItems:[{serviceId:service},{serviceId:second.id}]}).returning();
    const result=await report(`&serviceId=${second.id}`);
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.jobs).toHaveLength(1);
    expect(result.body.jobs[0]).toMatchObject({id:mixed.id,multiService:true,measurement:null,measurementUnit:null,matrixLabel:"Unallocated across services"});
  });
  it("uses the company's DST calendar at both date boundaries",async()=>{
    const makeJob=async(title:string,completedAt:string)=>(await db.insert(jobsTable).values({tenantId:tenant,title,
      status:"completed",scheduledAt:new Date("2020-03-07T12:00Z"),completedAt:new Date(completedAt)}).returning())[0].id;
    const inside=await makeJob("DST last minute","2020-03-09T05:59:00Z");
    const outside=await makeJob("Next day","2020-03-09T06:00:00Z");
    const result=await request(app).get("/api/reports/job-economics?from=2020-03-08&to=2020-03-08");
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.jobs.map((j:any)=>j.id)).toContain(inside);
    expect(result.body.jobs.map((j:any)=>j.id)).not.toContain(outside);
  });
  it("freezes quote supply costs before inventory changes and keeps estimate tax out of revenue",async()=>{
    const [estimate]=await db.insert(estimatesTable).values({tenantId:tenant,customerId:customer,status:"approved",subtotal:300,tax:30,total:330,
      estimatedDurationMin:120,suppliesNeeded:[{inventoryItemId:part,name:"Seed",quantity:2,unit:"bag"}]}).returning();
    await db.update(inventoryItemsTable).set({unitPrice:50}).where(eq(inventoryItemsTable.id,part));
    const [converted]=await db.insert(jobsTable).values({tenantId:tenant,customerId:customer,propertyId:property,serviceId:service,
      assigneeId:tech,title:"Converted estimate fixture",status:"completed",totalAmount:330,estimatedDuration:120,
      scheduledAt:new Date("2020-01-02T10:00Z"),completedAt:new Date("2020-01-02T15:00Z"),
      suppliesNeeded:[{inventoryItemId:part,name:"Seed",quantity:2,unit:"bag"}]}).returning();
    await db.update(estimatesTable).set({convertedToJobId:converted.id}).where(eq(estimatesTable.id,estimate.id));
    await db.update(estimatesTable).set({subtotal:500,total:550,tax:50}).where(eq(estimatesTable.id,estimate.id));
    const row=(await report()).body.jobs.find((j:any)=>j.id===converted.id);
    expect(row).toMatchObject({revenue:300,budgetRevenue:300,budgetMaterialCost:50,estimateId:estimate.id,budgetMinutes:120});
    expect(row.totalCost).toBeNull();expect(row.profit).toBeNull();
  });
  it("labels legacy current measurements, includes archived history, and leaves unavailable budgets blank",async()=>{
    await db.execute(sql`DELETE FROM job_report_baselines WHERE job_id=${job} AND tenant_id=${tenant}`);
    await db.update(customersTable).set({archivedAt:new Date()}).where(eq(customersTable.id,customer));
    const row=(await report()).body.jobs.find((j:any)=>j.id===job);
    expect(row).toMatchObject({measurement:9000,measurementSource:"current_property",budgetMaterialCost:null,budgetLaborCost:null});
    expect(row.issues.join(" ")).toContain("not saved");
  });
});
