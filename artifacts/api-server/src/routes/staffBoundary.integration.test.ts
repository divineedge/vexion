import { createHash, randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
const fixture=vi.hoisted(()=>({connection:null as any}));
vi.mock("@workspace/db",async original=>{const module=await original<typeof import("@workspace/db")>();return {...module,db:new Proxy(module.db,{get(target,key){const active=fixture.connection??target;const value=active[key];return typeof value==="function"?value.bind(active):value;}})};});
import { db,pool, staffSessionsTable, tenantsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./index";

const RUN = !!process.env.DATABASE_URL;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// One non-public path for every router mounted behind the boundary in index.ts.
const privateRouterPaths = [
  ["experience","/experience"],
  ["experienceAdmin","/experience/admin"],
  ["accountSecurity","/account-security"],
  ["softwareBilling","/software-billing"],
  ["platformBilling","/platform-billing/admin"],
  ["storage", "/storage/uploads/request-url"],
  ["media", "/properties/1/media"],
  ["dashboard", "/dashboard"],
  ["customers", "/customers"],
  ["properties", "/properties"],
  ["jobs", "/jobs"],
  ["jobRequests", "/job-requests"],
  ["crews", "/crews"],
  ["inventory", "/inventory"],
  ["inventoryLocations", "/inventory-locations"],
  ["invoices", "/invoices"],
  ["timeTracking", "/time-tracking/master-clock"],
  ["blueprints", "/blueprints"],
  ["settings", "/settings"],
  ["plans", "/plans"],
  ["servicePlans", "/customer-plans"],
  ["efficiency", "/efficiency"],
  ["callbacks", "/callbacks"],
  ["marketing", "/marketing"],
  ["p4p", "/p4p"],
  ["services", "/services"],
  ["chemicals", "/chemical-products"],
  ["equipment", "/equipment"],
  ["quotes", "/properties/1/quotes"],
  ["communications", "/communications/customers/1"],
  ["estimates", "/estimates"],
  ["visits", "/visits"],
  ["estimateTemplates", "/estimate-templates"],
  ["billing", "/billing/recurring-templates"],
  ["reports", "/reports"],
  ["vendors", "/vendors"],
  ["expenses", "/expenses"],
  ["broadcasts", "/broadcasts"],
  ["integrations", "/integrations"],
  ["devTools", "/dev-tools/environment"],
  ["reviews", "/reviews"],
  ["stopServiceFlags", "/stop-service-flags"],
  ["internalTasks", "/internal-tasks"],
  ["routing", "/routing"],
  ["taskBundles", "/task-bundles"],
  ["followupQueue", "/followup-queue"],
  ["importBatches", "/import-batches"],
  ["employeeHistory", "/employee-history"],
  ["repairLogs", "/repair-logs"],
  ["planCancelRequests", "/plan-cancel-requests"],
  ["tags", "/tags"],
  ["skipReasons", "/skip-reasons"],
  ["portalMessages", "/portal-inbox"],
  ["staffNotes", "/staff-notes"],
  ["invoiceTemplates", "/invoice-templates"],
  ["jobMessages", "/jobs/1/messages"],
  ["staffMessages", "/staff-messages"],
  ["staffNotificationDevices", "/staff-notification-devices"],
  ["jobEquipmentUses", "/jobs/1/equipment-uses"],
] as const;

describe.skipIf(!RUN)("server-wide verified staff boundary", () => {
  const app = express();
  app.use(express.json());
  app.use(router);

  const tenantIds: number[] = [];
  let tenantAId: number;
  let tenantBId: number;
  let userAId: number;
  let validA: string;
  let validB: string;
  let inactiveStaffToken: string;
  let logoutToken: string;
  let bearerLogoutToken: string;
  let expired: string;
  let mockEmail: string;

  const connectFixture=()=>pool.connect();
  let fixtureClient:Awaited<ReturnType<typeof connectFixture>>,savepoint=0;
  beforeAll(async () => {
    fixtureClient=await pool.connect();await fixtureClient.query("BEGIN");
    const base=drizzle(fixtureClient);
    fixture.connection=new Proxy(base,{get(target,key){if(key==="transaction")return async(fn:any)=>{const name=`boundary_${++savepoint}`;await fixtureClient.query(`SAVEPOINT ${name}`);try{const result=await fn(fixture.connection);await fixtureClient.query(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await fixtureClient.query(`ROLLBACK TO SAVEPOINT ${name}`);await fixtureClient.query(`RELEASE SAVEPOINT ${name}`);throw error;}};const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;}});
    const suffix = randomBytes(8).toString("hex");
    const [tenantA, tenantB] = await db.insert(tenantsTable).values([
      { name: `__boundary_A_${suffix}__` },
      { name: `__boundary_B_${suffix}__` },
    ]).returning({ id: tenantsTable.id });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    tenantIds.push(tenantAId, tenantBId);
    mockEmail = `boundary-${suffix}@example.invalid`;

    const [userA, userB, inactiveUser] = await db.insert(usersTable).values([
      { tenantId: tenantAId, name: "Boundary A", email: mockEmail, role: "company_owner", passwordHash: "mock", isActive: true },
      { tenantId: tenantBId, name: "Boundary B", email: `boundary-b-${suffix}@example.invalid`, role: "company_owner", passwordHash: "mock", isActive: true },
      { tenantId: tenantAId, name: "Inactive Boundary", email: `boundary-inactive-${suffix}@example.invalid`, role: "technician", passwordHash: "mock", isActive: false },
    ]).returning({ id: usersTable.id });
    userAId = userA.id;

    validA = `valid-a-${suffix}`;
    validB = `valid-b-${suffix}`;
    inactiveStaffToken = `inactive-${suffix}`;
    logoutToken = `logout-${suffix}`;
    bearerLogoutToken = `bearer-logout-${suffix}`;
    expired = `expired-${suffix}`;
    await db.insert(staffSessionsTable).values([
      { tenantId: tenantAId, userId: userA.id, tokenHash: hash(validA), expiresAt: new Date(Date.now() + 60_000) },
      { tenantId: tenantBId, userId: userB.id, tokenHash: hash(validB), expiresAt: new Date(Date.now() + 60_000) },
      { tenantId: tenantAId, userId: inactiveUser.id, tokenHash: hash(inactiveStaffToken), expiresAt: new Date(Date.now() + 60_000) },
      { tenantId: tenantAId, userId: userA.id, tokenHash: hash(logoutToken), expiresAt: new Date(Date.now() + 60_000) },
      { tenantId: tenantAId, userId: userA.id, tokenHash: hash(bearerLogoutToken), expiresAt: new Date(Date.now() + 60_000) },
      { tenantId: tenantAId, userId: userA.id, tokenHash: hash(expired), expiresAt: new Date(Date.now() - 60_000) },
    ]);
  });

  afterAll(async () => {
    try{await fixtureClient.query("ROLLBACK");}finally{fixture.connection=null;fixtureClient.release();await pool.end();}
  });

  for (const [name, path] of privateRouterPaths) {
    it.each([
      ["missing session with forged identity headers", undefined],
      ["invalid session with forged identity headers", "invalid-session"],
      ["expired session with forged identity headers", () => expired],
    ])(`${name} rejects %s`, async (_case, token) => {
      const response = request(app).get(path)
        .set("x-tenant-id", String(tenantBId))
        .set("x-user-id", "999999");
      const resolved = typeof token === "function" ? token() : token;
      if (resolved) response.set("x-staff-session", resolved);
      expect((await response).status).toBe(401);
    });
  }

  it("uses the valid session tenant even when both identity headers name another tenant", async () => {
    const response = await request(app).get("/settings")
      .set("x-staff-session", validA)
      .set("x-tenant-id", String(tenantBId))
      .set("x-user-id", "999999");
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(tenantAId);
  });

  it("keeps both tenants' valid session identities distinct", async () => {
    const [a, b] = await Promise.all([
      request(app).get("/auth/me").set("x-staff-session", validA),
      request(app).get("/auth/me").set("x-staff-session", validB),
    ]);
    expect(a.body.tenantId).toBe(tenantAId);
    expect(b.body.tenantId).toBe(tenantBId);
  });

  it("leaves explicit public route families outside the staff boundary", async () => {
    expect((await request(app).get("/healthz")).status).toBe(200);
    expect((await request(app).get("/widget/services")).status).not.toBe(401);
    expect((await request(app).get("/portal/tenant-info")).status).not.toBe(401);
    expect((await request(app).post("/portal/auth/login").set("x-tenant-id", String(tenantAId)).send({})).status).toBe(400);
    expect((await request(app).get("/quotes/not-a-real-token")).status).toBe(404);
    expect((await request(app).get("/public/estimates/not-a-real-token")).status).toBe(404);
  });

  it("/auth/me requires a verified session and ignores forged headers", async () => {
    const response = await request(app).get("/auth/me")
      .set("x-tenant-id", String(tenantAId))
      .set("x-user-id", String(userAId));
    expect(response.status).toBe(401);
  });

  it("/auth/logout revokes the presented staff session", async () => {
    expect((await request(app).post("/auth/logout").set("x-staff-session", logoutToken)).status).toBe(200);
    expect((await request(app).get("/auth/me").set("x-staff-session", logoutToken)).status).toBe(401);
  });

  it("/auth/logout revokes the bearer session used by the field app", async () => {
    expect((await request(app).post("/auth/logout").set("authorization", `Bearer ${bearerLogoutToken}`)).status).toBe(200);
    expect((await request(app).get("/settings").set("authorization", `Bearer ${bearerLogoutToken}`)).status).toBe(401);
  });

  it("rejects an inactive staff session from both mixed staff/portal storage readers", async () => {
    const headers = { "x-staff-session": inactiveStaffToken };
    expect((await request(app).get("/storage/read-url?objectPath=/objects/not-found").set(headers)).status).toBe(401);
    expect((await request(app).get("/storage/objects/not-found").set(headers)).status).toBe(401);
  });

  it("rejects passwordHash='mock' login in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await request(app).post("/auth/login").send({ email: mockEmail, password: "anything" });
      expect(response.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});