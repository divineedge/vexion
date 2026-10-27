import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import request from "supertest";
const state=vi.hoisted(()=>({connection:null as any,tenant:0,user:0}));
vi.mock("@workspace/db",async original=>{
  const m=await original<typeof import("@workspace/db")>();
  return {...m,db:new Proxy(m.db,{get(target,key){const source=state.connection??target;const value=source[key];return typeof value==="function"?value.bind(source):value;}})};
});
vi.mock("./mailchimpSync",()=>({syncCustomerToMailchimp:vi.fn()}));
import {db,pool,tenantsTable,usersTable,customersTable,activityLogTable} from "@workspace/db";
import {and,eq} from "drizzle-orm";
import router from "../routes/customers";
describe("customer creation and explicit duplicate decisions",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>,savepoint=0;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{verifiedTenantId:state.tenant,verifiedUserId:state.user});next();});app.use(router);
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");const connection=drizzle(client);
    state.connection=new Proxy(connection,{get(target,key){
      if(key==="transaction")return async(fn:(tx:any)=>Promise<unknown>)=>{const name=`customer_guard_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);try{const value=await fn(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return value;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}};
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
    const[t]=await db.insert(tenantsTable).values({name:"QA customer creation",slug:`qa-create-${Date.now()}`}).returning();state.tenant=t.id;
    const[u]=await db.insert(usersTable).values({tenantId:t.id,name:"QA owner",email:`qa-create-${t.id}@example.invalid`,role:"company_owner",passwordHash:"mock"}).returning();state.user=u.id;
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
});
