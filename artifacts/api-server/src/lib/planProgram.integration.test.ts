import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from "vitest";
const state=vi.hoisted(()=>({connection:null as any,tenant:0,owner:0}));
vi.mock("@workspace/db",async(importOriginal)=>{
  const original=await importOriginal<any>();
  return {...original,db:new Proxy(original.db,{get(target,key){
    const source=state.connection??target,value=source[key];
    return typeof value==="function"?value.bind(source):value;
  }})};
});
vi.mock("./tenantHelper",async(importOriginal)=>({...await importOriginal<any>(),getTenantId:()=>state.tenant,getUserId:()=>state.owner}));
import express from "express";
import type { Server } from "node:http";
import servicePlansRouter from "../routes/servicePlans";
import { db,pool,tenantsTable,usersTable,customersTable,propertiesTable,servicesTable,crewsTable,planTemplatesTable,customerPlansTable,jobsTable,activityLogTable } from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { and,eq } from "drizzle-orm";
import { buildPlanProgram } from "./planProgram";
import { validateVisitRange,planDateInZone } from "./planVisitRange";
import { generateRangeJobs } from "./planRangeJobs";
import { enforceCrewCapacity,CrewCapacityError,capacityCheckedJobUpdate } from "./crewCapacity";
import type { PlanServiceRule } from "./planSchedulingEngine";
import { paymentGuardedJobInsert } from "./paymentPolicy";

describe("plan programs — real database, all fixtures rolled back",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>;
  let tenant:number,owner:number,customer:number,property:number,crewA:number,crewB:number,template:number;
  let catalog:Array<typeof servicesTable.$inferSelect>,rules:PlanServiceRule[];
  let serial=0;
  let server:Server,base:string;
  const zone="America/Denver";
  const config=()=>validateVisitRange({
    firstServiceDate:"2027-04-01",lastServiceDate:"2027-08-29",totalVisits:5,spacingUnit:"weeks",preferredWeekday:1,
    defaultCrewId:crewA,serviceCrews:[{serviceId:catalog[1].id,crewId:crewB}],
    visitServices:[{visitNumber:1,serviceIds:catalog.map(s=>s.id)},{visitNumber:2,serviceIds:catalog.map(s=>s.id)},
      {visitNumber:3,serviceIds:[catalog[1].id]},{visitNumber:4,serviceIds:[catalog[0].id]},{visitNumber:5,serviceIds:catalog.map(s=>s.id)}],
    chemicalServiceIds:[catalog[0].id],emailReminder:true,smsReminder:true,pushReminder:true,
  });
  async function plan(schedule=config()){
    return (await db.insert(customerPlansTable).values({
      tenantId:tenant,customerId:customer,propertyId:property,templateId:template,templateName:"Rollback service program",
      status:"active",billingPrice:100,billingCycle:"monthly",autoRenew:false,
      startDate:planDateInZone(schedule.firstServiceDate,zone),endDate:new Date("2027-05-01T18:00:00Z"),
      nextBillingDate:"2027-05-01",serviceState:rules,visitSchedule:{...schedule,timeZone:zone},
    }).returning())[0];
  }
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    const raw=drizzle(client,{schema});
    state.connection=new Proxy(raw,{get(target,key){
      if(key==="transaction")return async(fn:any)=>{
        const name=`program_${++serial}`;await client.query(`SAVEPOINT ${name}`);
        try{const result=await fn(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
        catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);throw error;}
      };
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});
    const token=`program-${Date.now()}`;
    [tenant]= (await db.insert(tenantsTable).values({name:"Rollback program fixtures",slug:token,timezone:zone}).returning()).map(r=>r.id);
    [owner]=(await db.insert(usersTable).values({tenantId:tenant,name:"Fixture owner",email:`${token}@example.invalid`,role:"company_owner",passwordHash:"not-a-login"}).returning()).map(r=>r.id);
    state.tenant=tenant;state.owner=owner;
    [customer]=(await db.insert(customersTable).values({tenantId:tenant,name:"Fixture customer",email:"program@example.invalid",phone:"0000000000"}).returning()).map(r=>r.id);
    [property]=(await db.insert(propertiesTable).values({tenantId:tenant,customerId:customer,address:"Rollback test property"}).returning()).map(r=>r.id);
    const crews=await db.insert(crewsTable).values([{tenantId:tenant,name:"Fertilizer",dailyCapacityMinutes:480,travelBufferMinutes:0},{tenantId:tenant,name:"Sprinkler",dailyCapacityMinutes:480,travelBufferMinutes:0}]).returning();
    crewA=crews[0].id;crewB=crews[1].id;
    catalog=await db.insert(servicesTable).values([{tenantId:tenant,name:"Fertilizer fixture",estimatedDuration:60},{tenantId:tenant,name:"Sprinkler fixture",estimatedDuration:30}]).returning();
    rules=catalog.map(s=>({serviceId:s.id,serviceName:s.name,frequencyDays:30,bufferDays:0})) as PlanServiceRule[];
    [template]=(await db.insert(planTemplatesTable).values({tenantId:tenant,name:"Fixture program",services:rules,billingCycle:"monthly",price:100,visitCount:5}).returning()).map(r=>r.id);
    const app=express();app.use(express.json());app.use(servicePlansRouter);
    app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof CrewCapacityError?409:500).json({error:(error as Error).message}));
    server=await new Promise<Server>(resolve=>{const listening=app.listen(0,"127.0.0.1",()=>resolve(listening));});
    base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  beforeEach(async()=>{await client.query("SAVEPOINT test_case");});
  afterEach(async()=>{await client.query("ROLLBACK TO SAVEPOINT test_case");await client.query("RELEASE SAVEPOINT test_case");});
  afterAll(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    state.connection=null;
    if(client){try{await client.query("ROLLBACK");}finally{client.release();await pool.end();}}
  });
  async function post(path:string,visitSchedule=config()){
    const result=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      templateId:template,customerId:customer,propertyId:property,startDate:visitSchedule.firstServiceDate,visitSchedule,
    })});
    return {status:result.status,body:await result.json() as {id:number;visits:Array<{date:string}>;capacityWarnings:string[]}};
  }
  it("previews and sells the same authoritative per-round jobs through the actual API",async()=>{
    const preview=await post("/customer-plans/preview");
    expect(preview.status,JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.visits).toHaveLength(8);
    expect(preview.body.capacityWarnings).toEqual([]);
    const sale=await post("/customer-plans");
    expect(sale.status,JSON.stringify(sale.body)).toBe(201);
    const created=await db.select().from(jobsTable).where(eq(jobsTable.planId,sale.body.id));
    expect(created).toHaveLength(8);
    expect(created.map(j=>j.scheduledAt.toISOString())).toEqual(preview.body.visits.map((v:any)=>v.date));
  });
  it("rejects an over-capacity sale atomically; an owner can explicitly approve the same day",async()=>{
    await db.insert(jobsTable).values({tenantId:tenant,title:"Preexisting work",crewId:crewA,scheduledAt:planDateInZone("2027-04-01",zone),estimatedDuration:450});
    const preview=await post("/customer-plans/preview");
    expect(preview.status).toBe(200);
    expect(preview.body.capacityWarnings.length).toBeGreaterThan(0);
    const blocked=await post("/customer-plans");
    expect(blocked.status,JSON.stringify(blocked.body)).toBe(409);
    expect(await db.select().from(customerPlansTable).where(eq(customerPlansTable.tenantId,tenant))).toHaveLength(0);
    const schedule=config();schedule.capacityOverrideReason="Owner approved urgent service on this date";
    const sale=await post("/customer-plans",schedule);
    expect(sale.status,JSON.stringify(sale.body)).toBe(201);
    const created=await db.select().from(jobsTable).where(eq(jobsTable.planId,sale.body.id));
    expect(created).toHaveLength(8);
    expect(created.some(j=>j.capacityOverrideBy===owner)).toBe(true);
  });
  it("groups services by crew and preserves five rounds, channel choices and chemical attribution",async()=>{
    const schedule=config(),program=await buildPlanProgram(tenant,rules,catalog,schedule,zone);
    expect(program).toHaveLength(8);
    expect(new Set(program.map(v=>v.roundNumber)).size).toBe(5);
    expect(program.find(v=>v.roundNumber===3)?.serviceIds).toEqual([catalog[1].id]);
    expect(program.find(v=>v.crewId===crewA)?.lineItems[0].chemicalTracking).toBe(true);
    const sold=await plan(schedule);
    expect(await generateRangeJobs(sold.id,tenant)).toBe(8);
    expect(await generateRangeJobs(sold.id,tenant)).toBe(0);
    const rows=await db.select().from(jobsTable).where(eq(jobsTable.planId,sold.id));
    expect(rows.every(row=>row.emailReminderEnabled&&row.smsReminderEnabled&&row.pushReminderEnabled)).toBe(true);
    expect(rows.filter(row=>row.crewId===crewA)).toHaveLength(4);
    // Billing remains monthly although the service range spans five months.
    expect(sold.endDate.toISOString().slice(0,10)).toBe("2027-05-01");
  });
  it("joins only remaining source rounds and retains the source treatment sequence",async()=>{
    const source=await plan();await generateRangeJobs(source.id,tenant);
    const schedule=validateVisitRange({firstServiceDate:"2027-06-01",lastServiceDate:"2027-10-01",totalVisits:5,preferredWeekday:1,alignToPlanId:source.id});
    const joined=await buildPlanProgram(tenant,rules,catalog,schedule,zone);
    expect(schedule.totalVisits).toBe(3);
    expect(schedule.firstServiceDate).toBe("2027-06-14");
    expect(joined[0].serviceIds).toEqual([catalog[1].id]);
    expect(joined.at(-1)?.serviceIds).toEqual(catalog.map(s=>s.id));
    const last=validateVisitRange({firstServiceDate:"2027-08-20",lastServiceDate:"2027-10-01",totalVisits:5,preferredWeekday:1,alignToPlanId:source.id});
    await buildPlanProgram(tenant,rules,catalog,last,zone);
    expect(last.totalVisits).toBe(1);
    expect(validateVisitRange(last).totalVisits).toBe(1);
  });
  it("counts other jobs, blocks overflow, and audits only authorized explicit overrides",async()=>{
    const day=planDateInZone("2027-07-12",zone);
    await db.insert(jobsTable).values({tenantId:tenant,title:"Existing non-plan work",crewId:crewA,scheduledAt:day,estimatedDuration:450});
    const input={tenantId:tenant,title:"New program service",crewId:crewA,scheduledAt:day,estimatedDuration:60};
    await expect(paymentGuardedJobInsert(db).values(input).returning()).rejects.toBeInstanceOf(CrewCapacityError);
    await expect(paymentGuardedJobInsert(db,{reason:"Urgent requested work",actorId:-1}).values(input).returning()).rejects.toBeInstanceOf(CrewCapacityError);
    const [saved]=await paymentGuardedJobInsert(db,{reason:"Urgent requested work",actorId:owner}).values(input).returning();
    expect(saved.capacityOverrideBy).toBe(owner);
    expect(saved.capacityOverrideReason).toBe("Urgent requested work");
    expect((await db.select().from(activityLogTable).where(and(eq(activityLogTable.tenantId,tenant),eq(activityLogTable.type,"crew_capacity_override"))))).toHaveLength(1);
  });
  it("moves work to available time without replacing a requested appointment on normal jobs",async()=>{
    const day=planDateInZone("2027-07-12",zone),eight=new Date(day.getTime()-4*3600000);
    await db.insert(jobsTable).values({tenantId:tenant,title:"Existing appointment",crewId:crewA,scheduledAt:eight,estimatedDuration:60});
    const input={tenantId:tenant,title:"Flexible plan visit",crewId:crewA,scheduledAt:eight,estimatedDuration:60};
    await expect(db.transaction(tx=>enforceCrewCapacity(tx,input))).rejects.toBeInstanceOf(CrewCapacityError);
    const [saved]=await paymentGuardedJobInsert(db,{autoPlace:true}).values(input).returning();
    expect(saved.scheduledAt.getTime()).toBe(eight.getTime()+3600000);
  });
  it("reschedules and cancelled visits keep their slots; a worker never recreates them",async()=>{
    const sold=await plan();await generateRangeJobs(sold.id,tenant);
    const rows=await db.select().from(jobsTable).where(eq(jobsTable.planId,sold.id));
    await capacityCheckedJobUpdate(eq(jobsTable.id,rows[0].id),{scheduledAt:planDateInZone("2027-04-02",zone)});
    await db.update(jobsTable).set({status:"cancelled"}).where(eq(jobsTable.id,rows[1].id));
    expect(await generateRangeJobs(sold.id,tenant)).toBe(0);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.planId,sold.id))).toHaveLength(8);
  });
});
