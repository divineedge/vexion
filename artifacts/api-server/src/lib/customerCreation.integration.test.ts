import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import request from "supertest";
const state=vi.hoisted(()=>({connection:null as any,tenant:0,user:0,worker:0,crew:0}));
vi.mock("../routes/auth",async importOriginal=>({
  ...await importOriginal<typeof import("../routes/auth")>(),
  resolveStaffSession:async()=>({tenantId:state.tenant,userId:state.user}),
}));
vi.mock("@workspace/db",async original=>{
  const m=await original<typeof import("@workspace/db")>();
  return {...m,db:new Proxy(m.db,{get(target,key){const source=state.connection??target;const value=source[key];return typeof value==="function"?value.bind(source):value;}})};
});
vi.mock("./mailchimpSync",()=>({syncCustomerToMailchimp:vi.fn()}));
import {db,pool,tenantsTable,usersTable,customersTable,activityLogTable,jobsTable,jobReportBaselinesTable,crewsTable,crewMembersTable,estimatesTable} from "@workspace/db";
import {and,eq} from "drizzle-orm";
import router from "../routes/customers";
import jobsRouter from "../routes/jobs";
import estimatesRouter from "../routes/estimates";
import { enforceCrewCapacity,CrewCapacityError } from "./crewCapacity";
describe("customer creation and explicit duplicate decisions",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>,savepoint=0;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{verifiedTenantId:state.tenant,verifiedUserId:state.user});next();});app.use(router);app.use(jobsRouter);app.use(estimatesRouter);
  app.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error instanceof CrewCapacityError?409:error.status??500).json({error:error.message});});
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");const connection=drizzle(client);
    state.connection=new Proxy(connection,{get(target,key){
      if(key==="transaction")return async(fn:(tx:any)=>Promise<unknown>)=>{const name=`customer_guard_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);try{const value=await fn(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}};
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
    const[t]=await db.insert(tenantsTable).values({name:"QA customer creation",slug:`qa-create-${Date.now()}`}).returning();state.tenant=t.id;
    const[u]=await db.insert(usersTable).values({tenantId:t.id,name:"QA owner",email:`qa-create-${t.id}@example.invalid`,role:"company_owner",passwordHash:"mock"}).returning();state.user=u.id;
    const[worker]=await db.insert(usersTable).values({tenantId:t.id,name:"QA employee",email:`qa-worker-${t.id}@example.invalid`,role:"technician",passwordHash:"mock"}).returning();state.worker=worker.id;
    const[crew]=await db.insert(crewsTable).values({tenantId:t.id,name:"QA crew",dailyCapacityMinutes:480,travelBufferMinutes:15}).returning();state.crew=crew.id;
    await db.insert(crewMembersTable).values({tenantId:t.id,crewId:crew.id,userId:worker.id});
  });
  afterAll(async()=>{await client?.query("ROLLBACK");state.connection=null;client?.release();await pool.end();});
  it("creates once, explains a matching record, and only creates separately after an explicit decision",async()=>{
    const body={name:"QA duplicate check",email:"qa-duplicate@example.invalid",phone:"3035550197",physicalAddress:"1437 Bannock St",physicalCity:"Denver",physicalState:"CO",physicalZip:"80202",physicalLat:39.7392,physicalLng:-104.9903};
    const created=await request(app).post("/customers").send(body);expect(created.status,JSON.stringify(created.body)).toBe(201);
    const blocked=await request(app).post("/customers").send(body);expect(blocked.status).toBe(409);expect(blocked.body.existingCustomerId).toBe(created.body.id);
    const stringOverride=await request(app).post("/customers").send({...body,allowPossibleDuplicate:"true"});expect(stringOverride.status).toBe(409);
    const separate=await request(app).post("/customers").send({...body,allowPossibleDuplicate:true});expect(separate.status,JSON.stringify(separate.body)).toBe(201);expect(separate.body.id).not.toBe(created.body.id);
    const rows=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));expect(rows).toHaveLength(2);expect(rows.every(row=>!row.stripeCustomerId)).toBe(true);
    const audit=await db.select().from(activityLogTable).where(and(eq(activityLogTable.tenantId,state.tenant),eq(activityLogTable.entityId,separate.body.id)));expect(audit.some(row=>row.message.includes("after duplicate warning"))).toBe(true);
  });
  it("deletes an unused job and its generated report baseline without orphaning data",async()=>{
    const [customer]=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));
    const [job]=await db.insert(jobsTable).values({tenantId:state.tenant,customerId:customer.id,title:"Unused QA job",scheduledAt:new Date("2031-01-10T17:00:00Z"),status:"scheduled"}).returning();
    await db.insert(jobReportBaselinesTable).values({tenantId:state.tenant,jobId:job.id,baseline:{}}).onConflictDoNothing();
    const result=await request(app).delete(`/jobs/${job.id}`);expect(result.status,JSON.stringify(result.body)).toBe(204);
    expect(await db.select().from(jobsTable).where(eq(jobsTable.id,job.id))).toHaveLength(0);
    expect(await db.select().from(jobReportBaselinesTable).where(eq(jobReportBaselinesTable.jobId,job.id))).toHaveLength(0);
  });
  it("preserves completed unbilled work on delete and archive, and archives unused work safely",async()=>{
    const [customer]=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));
    const [completed]=await db.insert(jobsTable).values({tenantId:state.tenant,customerId:customer.id,title:"Completed QA job",scheduledAt:new Date("2031-01-10T17:00:00Z"),status:"completed"}).returning();
    expect((await request(app).delete(`/jobs/${completed.id}`)).status).toBe(409);
    expect((await request(app).post(`/jobs/${completed.id}/archive`)).status).toBe(409);
    const [unused]=await db.insert(jobsTable).values({tenantId:state.tenant,customerId:customer.id,title:"Archive QA job",scheduledAt:new Date("2031-01-10T17:00:00Z"),status:"scheduled"}).returning();
    expect((await request(app).post(`/jobs/${unused.id}/archive`)).status).toBe(204);
    const [retained]=await db.select().from(jobsTable).where(eq(jobsTable.id,unused.id));expect(retained.archivedAt).not.toBeNull();
  });
  it("checks individual assignments against crew work, requires durations, and permits audited manager overrides",async()=>{
    const [customer]=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));
    await db.insert(jobsTable).values({tenantId:state.tenant,customerId:customer.id,title:"Crew time fixture",crewId:state.crew,scheduledAt:new Date("2031-01-11T17:00:00Z"),estimatedDuration:60,status:"scheduled"});
    const job={tenantId:state.tenant,customerId:customer.id,title:"Individual time fixture",assigneeId:state.worker,scheduledAt:new Date("2031-01-11T17:30:00Z"),estimatedDuration:30,status:"scheduled"};
    await expect(db.transaction(tx=>enforceCrewCapacity(tx,job))).rejects.toBeInstanceOf(CrewCapacityError);
    const allowed=await db.transaction(tx=>enforceCrewCapacity(tx,job,{actorId:state.user,reason:"Customer requires this appointment"}));expect(allowed.capacityOverrideBy).toBe(state.user);
    await expect(db.transaction(tx=>enforceCrewCapacity(tx,{...job,scheduledAt:new Date("2031-01-11T20:00:00Z"),estimatedDuration:null}))).rejects.toBeInstanceOf(CrewCapacityError);
    const corrected=await db.transaction(tx=>enforceCrewCapacity(tx,{...job,scheduledAt:new Date("2031-01-11T20:00:00Z"),estimatedDuration:30}));expect(corrected.capacityOverrideBy).toBeNull();
    await expect(db.transaction(tx=>enforceCrewCapacity(tx,job,{actorId:state.worker,reason:"Not a manager override"}))).rejects.toBeInstanceOf(CrewCapacityError);
  });
  it("accepts booking duration and crew after estimate approval without changing quoted pricing or duration",async()=>{
    const [customer]=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));
    const [estimate]=await db.insert(estimatesTable).values({tenantId:state.tenant,customerId:customer.id,status:"approved",visitMode:"drop_by",subtotal:100,total:100,estimatedDurationMin:30,lineItems:[{name:"QA service",quantity:1,unitPrice:100,markup:0,total:100}]}).returning();
    const booking={title:"Accepted QA booking",scheduledAt:"2031-01-13T17:00:00Z",assigneeId:state.worker,crewId:state.crew,invoiceNow:false};
    expect((await request(app).post(`/estimates/${estimate.id}/convert`).send({...booking,estimatedDuration:0})).status).toBe(400);
    const result=await request(app).post(`/estimates/${estimate.id}/convert`).send({...booking,estimatedDuration:45});
    expect([200,201],JSON.stringify(result.body)).toContain(result.status);
    const [job]=await db.select().from(jobsTable).where(eq(jobsTable.id,result.body.jobId));
    expect(job.estimatedDuration).toBe(45);expect(job.crewId).toBe(state.crew);expect(job.assigneeId).toBe(state.worker);expect(job.invoiceId).toBeNull();
    const [quoted]=await db.select().from(estimatesTable).where(eq(estimatesTable.id,estimate.id));expect(quoted.estimatedDurationMin).toBe(30);expect(quoted.total).toBe(100);
  });
  it("checks capacity when approving a customer reschedule and accepts a corrected duration atomically",async()=>{
    const [customer]=await db.select().from(customersTable).where(eq(customersTable.tenantId,state.tenant));
    await db.update(customersTable).set({email:"",phone:""}).where(eq(customersTable.id,customer.id));
    const [job]=await db.insert(jobsTable).values({tenantId:state.tenant,customerId:customer.id,title:"QA pending reschedule",scheduledAt:new Date("2031-01-10T17:00:00Z"),status:"scheduled",crewId:state.crew,assigneeId:state.worker,rescheduleRequestedAt:new Date(),reschedulePreferredDate:"2031-01-14",rescheduleRequestStatus:"pending"}).returning();
    const choice={approvedDate:"2031-01-14",chargeRescheduleFee:false,rescheduleFeeAmount:0};
    const blocked=await request(app).post(`/jobs/${job.id}/approve-reschedule`).send(choice);
    expect(blocked.status,JSON.stringify(blocked.body)).toBe(409);
    const allowed=await request(app).post(`/jobs/${job.id}/approve-reschedule`).send({...choice,estimatedDuration:30});
    expect(allowed.status,JSON.stringify(allowed.body)).toBe(200);
    const [saved]=await db.select().from(jobsTable).where(eq(jobsTable.id,job.id));
    expect(saved.estimatedDuration).toBe(30);expect(saved.rescheduleRequestStatus).toBe("approved");
  });
});
