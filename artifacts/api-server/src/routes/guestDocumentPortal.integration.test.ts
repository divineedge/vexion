import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

const holder = vi.hoisted(() => ({ connection: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, { get(target, key) {
    const current = holder.connection ?? target, value = current[key];
    return typeof value === "function" ? value.bind(current) : value;
  } }) };
});
import { db, pool, tenantsTable, customersTable, propertiesTable, estimatesTable, invoicesTable, jobsTable, activityLogTable, usersTable, staffSessionsTable } from "@workspace/db";
import router from "./guestDocumentPortal";
import { companyDocumentLink, documentLink } from "../lib/documentLinks";
import settingsRouter from "./settings";
import { requireVerifiedStaff } from "../lib/verifiedStaff";

describe("Guest document portal (rollback-only fixtures)", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>, tenant: number, customer: number, p1: number, p2: number;
  let estimateToken: string, invoiceToken: string;
  const app = express().use(express.json()).use(router);
  const settingsApp = express().use(express.json()).use(requireVerifiedStaff).use(settingsRouter);
  let staffToken: string;
  beforeAll(async () => {
    client = await pool.connect(); await client.query("BEGIN");
    holder.connection = drizzle(client);
    tenant = (await db.insert(tenantsTable).values({name:"Guest document fixture"}).returning())[0].id;
    const owner=(await db.insert(usersTable).values({tenantId:tenant,name:"Guest fixture owner",email:`guest-owner-${tenant}@example.invalid`,role:"company_owner"}).returning())[0];
    staffToken=`guest-settings-${tenant}`;
    await db.insert(staffSessionsTable).values({tenantId:tenant,userId:owner.id,tokenHash:createHash("sha256").update(staffToken).digest("hex"),expiresAt:new Date(Date.now()+3600000)});
    const foreign = (await db.insert(tenantsTable).values({name:"Other company"}).returning())[0].id;
    customer = (await db.insert(customersTable).values({tenantId:tenant,name:"Guest customer",email:"guest@example.invalid",phone:"555-0100",billingAddress:"Mailing address"}).returning())[0].id;
    const other = (await db.insert(customersTable).values({tenantId:foreign,name:"Other customer",email:"",phone:""}).returning())[0];
    p1 = (await db.insert(propertiesTable).values({tenantId:tenant,customerId:customer,address:"First property",lat:40,lng:-105,notes:"Private staff note",measurementPolygons:[{id:"lawn",label:"Back lawn",vertices:[[40,-105],[40.001,-105],[40,-105.001]],areaSqft:1000}]}).returning())[0].id;
    p2 = (await db.insert(propertiesTable).values({tenantId:tenant,customerId:customer,address:"Second property",measurementPolygons:[{id:"gravel",label:"Gravel",vertices:[[40,-105],[40.001,-105],[40,-105.001]],areaSqft:200}]}).returning())[0].id;
    await db.insert(propertiesTable).values({tenantId:tenant,customerId:customer,address:"Unrelated private property"});
    const fp = (await db.insert(propertiesTable).values({tenantId:foreign,customerId:other.id,address:"Foreign secret property"}).returning())[0];
    estimateToken = `rollback-estimate-${tenant}`; invoiceToken = `rollback-invoice-${tenant}`;
    await db.insert(estimatesTable).values({tenantId:tenant,customerId:customer,propertyId:p1,approvalToken:estimateToken,status:"sent",lineItems:[{propertyId:fp.id}]}).returning();
    const inv=(await db.insert(invoicesTable).values({tenantId:tenant,customerId:customer,invoiceNumber:`GUEST-${tenant}`,publicToken:invoiceToken,lineItems:[{propertyId:p2},{propertyId:fp.id}]}).returning())[0];
    await db.insert(jobsTable).values({tenantId:tenant,customerId:customer,propertyId:p1,invoiceId:inv.id,title:"Guest fixture job",scheduledAt:new Date()});
  });
  afterAll(async () => { if(client) { try { await client.query("ROLLBACK"); } finally {holder.connection=null;client.release();await pool.end();} } });
  it("invalid tokens and kinds fail closed without sessions", async () => {
    expect((await request(app).get("/public/document-portal/invoice/no-such-token")).status).toBe(404);
    expect((await request(app).get(`/public/document-portal/customer/${estimateToken}`)).status).toBe(404);
  });
  it("estimate token determines company/customer/property despite stale forged identity", async () => {
    const res=await request(app).get(`/public/document-portal/estimate/${estimateToken}`).set("x-tenant-id","1").set("x-portal-token","foreign-session");
    expect(res.status).toBe(200); expect(res.body.companyName).toBe("Guest document fixture");
    expect(res.body.properties.map((p:any)=>p.id)).toEqual([p1]);
    expect(res.body.properties[0].measurementZones[0].label).toBe("Back lawn");
    expect(JSON.stringify(res.body)).not.toMatch(/Private staff note|Foreign secret|Unrelated private|rollback-estimate/);
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
  it("combined invoice includes both billed properties, not unrelated/foreign ones", async () => {
    const res=await request(app).get(`/public/document-portal/invoice/${invoiceToken}`);
    expect(res.status).toBe(200); expect(res.body.properties.map((p:any)=>p.id).sort()).toEqual([p1,p2].sort());
  });
  it("requires acknowledgement and correct reviewed property scope", async () => {
    const url=`/public/document-portal/estimate/${estimateToken}`;
    const body={email:"new@example.invalid",phone:"555-1234",address:"Proposed address",confirmed:true,propertyIds:[p1]};
    expect((await request(app).post(url).send({...body,confirmed:false})).status).toBe(400);
    expect((await request(app).post(url).send({...body,propertyIds:[p2]})).status).toBe(400);
    expect((await request(app).post(url).send({...body,email:"bad"})).status).toBe(400);
    expect((await request(app).post(url).send({...body,corrections:"Check gravel boundary"})).status).toBe(200);
    const [saved]=await db.select().from(customersTable).where(eq(customersTable.id,customer));
    expect(saved.email).toBe("guest@example.invalid"); expect(saved.phone).toBe("555-0100");
    const logs=await db.select().from(activityLogTable).where(eq(activityLogTable.tenantId,tenant));
    expect(logs).toHaveLength(1); expect(logs[0].message).toContain("Check gravel boundary");
  });
  it("honors the company's measurement visibility switch", async () => {
    await db.update(tenantsTable).set({portalShowMeasurements:false}).where(eq(tenantsTable.id,tenant));
    const res=await request(app).get(`/public/document-portal/estimate/${estimateToken}`);
    expect(res.body.showMeasurements).toBe(false); expect(res.body.properties[0].measurementZones).toEqual([]);
  });
  it("company chooses direct vs guest links; default preserves direct documents", async () => {
    expect(await companyDocumentLink(tenant,"estimate",estimateToken)).toContain(`/estimate/${estimateToken}`);
    expect(await companyDocumentLink(tenant,"estimate",estimateToken)).not.toContain("/portal/share");
    await db.update(tenantsTable).set({documentLinkDestination:"portal"}).where(eq(tenantsTable.id,tenant));
    expect(await companyDocumentLink(tenant,"invoice",invoiceToken)).toContain(`/portal/share/invoice/${invoiceToken}`);
    expect(documentLink("estimate","abc/def","document")).toContain("/estimate/abc%2Fdef");
  });
  it("autosave API persists the company choice on subsequent settings loads", async () => {
    const save=await request(settingsApp).patch("/settings").set("Authorization",`Bearer ${staffToken}`).send({documentLinkDestination:"document"});
    expect(save.status).toBe(200); expect(save.body.documentLinkDestination).toBe("document");
    const portal=await request(settingsApp).patch("/settings").set("Authorization",`Bearer ${staffToken}`).send({documentLinkDestination:"portal"});
    expect(portal.status).toBe(200);
    const loaded=await request(settingsApp).get("/settings").set("Authorization",`Bearer ${staffToken}`);
    expect(loaded.status).toBe(200); expect(loaded.body.documentLinkDestination).toBe("portal");
    const invalid=await request(settingsApp).patch("/settings").set("Authorization",`Bearer ${staffToken}`).send({documentLinkDestination:"other"});
    expect(invalid.status).toBe(400);
  });
});
