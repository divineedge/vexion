import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// All fixtures and requests share one rollback-only PostgreSQL connection.
const holder=vi.hoisted(()=>({connection:null as any}));
vi.mock("@workspace/db",async importOriginal=>{
  const original=await importOriginal<typeof import("@workspace/db")>();
  return {...original,db:new Proxy(original.db,{get(target,key){
    if(key==="transaction"&&holder.connection)return async(fn:any)=>fn(holder.connection);
    const current=holder.connection??target,value=current[key];
    return typeof value==="function"?value.bind(current):value;
  }})};
});
import { db,pool,tenantsTable,usersTable } from "@workspace/db";
import { defaultAcquisitionSettings } from "../lib/acquisitionRewards";
import router from "./acquisition";

describe("Growth settings partial autosave (rollback-only PostgreSQL)",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>;
  let tenant:number,otherTenant:number,owner:number,tech:number;
  const initial={...defaultAcquisitionSettings,doorHangersEnabled:true,
    employeeRewardsEnabled:true,employeeRewardType:"percent",employeeRewardValue:20,
    customerReferralsEnabled:true,referralRewardValue:12.5};
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{
    Object.assign(req,{verifiedTenantId:req.headers["x-qa-other"]?otherTenant:tenant,
      verifiedUserId:req.headers["x-qa-tech"]?tech:owner});next();
  });
  app.use(router);
  const endpoint="/marketing/acquisition/settings";
  const patch=(body:unknown)=>request(app).patch(endpoint).send(body as object);
  const get=()=>request(app).get(endpoint);
  beforeAll(async()=>{
    client=await connect();await client.query("BEGIN");holder.connection=drizzle(client);
    tenant=(await db.insert(tenantsTable).values({name:"Rollback growth autosave fixture"}).returning())[0].id;
    otherTenant=(await db.insert(tenantsTable).values({name:"Rollback separate company fixture"}).returning())[0].id;
    const addUser=async(role:string)=>(await db.insert(usersTable).values({tenantId:tenant,role,
      name:"Rollback growth user",email:`${role}-${tenant}@growth.invalid`}).returning())[0].id;
    owner=await addUser("company_owner");tech=await addUser("technician");
  });
  beforeEach(async()=>{
    await db.execute(sql`UPDATE tenants SET acquisition_settings=${JSON.stringify(initial)}::jsonb
      WHERE id IN (${tenant},${otherTenant})`);
  });
  afterAll(async()=>{
    if(client){try{await client.query("ROLLBACK");}finally{holder.connection=null;client.release();await pool.end();}}
  });

  it("saves the exact one-field website toggle payload and retains it on reload",async()=>{
    const enabled=await patch({quoteWidgetEnabled:true});
    expect(enabled.status).toBe(200);
    expect(enabled.body.settings).toEqual({...initial,quoteWidgetEnabled:true});
    expect((await get()).body.settings).toEqual(enabled.body.settings);
    const disabled=await patch({quoteWidgetEnabled:false});
    expect(disabled.status).toBe(200);
    expect((await get()).body.settings).toEqual(initial);
    const other=await db.execute(sql`SELECT acquisition_settings FROM tenants WHERE id=${otherTenant}`);
    expect(other.rows[0].acquisition_settings).toEqual(initial);
  });

  it("merges separate autosaves without resetting rewards or other switches",async()=>{
    expect((await patch({quoteWidgetEnabled:true})).status).toBe(200);
    expect((await patch({referralRewardValue:25})).status).toBe(200);
    expect((await patch({employeeRewardsEnabled:false})).status).toBe(200);
    expect((await get()).body.settings).toEqual({...initial,quoteWidgetEnabled:true,
      referralRewardValue:25,employeeRewardsEnabled:false});
  });

  it("supports legacy full and wrapped settings payloads",async()=>{
    expect((await patch({...initial,quoteWidgetEnabled:true})).status).toBe(200);
    expect((await patch({settings:{quoteWidgetEnabled:false}})).status).toBe(200);
    expect((await get()).body.settings).toEqual(initial);
  });

  it.each([
    {quoteWidgetEnabled:"true"}, {doorHangersEnabled:1}, {employeeRewardValue:-1},
    {employeeRewardType:"percent",employeeRewardValue:101}, {referralRewardType:"unknown"},
    {trigger:"signup"}, {unexpected:true}, {settings:null}, [],
  ])("rejects invalid changes without altering stored settings: %j",async body=>{
    expect((await patch(body)).status).toBe(400);
    expect((await get()).body.settings).toEqual(initial);
  });

  it("validates percentages against the existing saved reward amount",async()=>{
    expect((await patch({referralRewardValue:125})).status).toBe(200);
    expect((await patch({referralRewardType:"percent"})).status).toBe(400);
    expect((await get()).body.settings.referralRewardType).toBe("fixed");
    expect((await patch({referralRewardType:"percent",referralRewardValue:50})).status).toBe(200);
  });

  it("blocks technicians and cross-company staff before writing",async()=>{
    expect((await patch({quoteWidgetEnabled:true}).set("x-qa-tech","1")).status).toBe(403);
    expect((await patch({quoteWidgetEnabled:true}).set("x-qa-other","1")).status).toBe(403);
    expect((await get()).body.settings).toEqual(initial);
  });
});
