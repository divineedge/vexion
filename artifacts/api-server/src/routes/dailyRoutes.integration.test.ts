import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  crewMembersTable,
  crewsTable,
  customersTable,
  db,
  driveLegsTable,
  jobReportBaselinesTable,
  jobsTable,
  propertiesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import dailyRoutes from "./dailyRoutes";
import { installDailyRouteSchema } from "../lib/dailyRouteSchema";

function appFor(tenantId: number, userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { verifiedTenantId: tenantId, verifiedUserId: userId });
    next();
  });
  app.use(dailyRoutes);
  return app;
}

describe("daily route board", () => {
  const tenants: number[] = [];

  afterAll(async () => {
    for (const tenantId of tenants) {
      await db.delete(driveLegsTable).where(eq(driveLegsTable.tenantId, tenantId));
      await db.delete(jobReportBaselinesTable).where(eq(jobReportBaselinesTable.tenantId, tenantId));
      await db.execute(sql`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_rates_immutable') THEN
            ALTER TABLE payroll_rates DISABLE TRIGGER payroll_rates_immutable;
          END IF;
        END $$
      `);
      await db.execute(sql`DELETE FROM payroll_rates WHERE tenant_id = ${tenantId}`);
      await db.execute(sql`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_rates_immutable') THEN
            ALTER TABLE payroll_rates ENABLE TRIGGER payroll_rates_immutable;
          END IF;
        END $$
      `);
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenantId));
      await db.delete(crewMembersTable).where(eq(crewMembersTable.tenantId, tenantId));
      await db.delete(crewsTable).where(eq(crewsTable.tenantId, tenantId));
      await db.delete(propertiesTable).where(eq(propertiesTable.tenantId, tenantId));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
      await db.update(usersTable).set({ managerId: null }).where(eq(usersTable.tenantId, tenantId));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
  });

  it("seeds an empty company once, then scopes crew, manager, and owner", async () => {
    await installDailyRouteSchema();
    const key = randomUUID();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Route QA", slug: key, p4pMasterPercentage: 25 }).returning();
    tenants.push(tenant.id);
    const [owner] = await db.insert(usersTable).values({
      tenantId: tenant.id, name: "Existing Owner", email: `${key}@example.invalid`, role: "company_owner",
    }).returning();
    const [kept] = await db.insert(jobsTable).values({
      tenantId: tenant.id, title: "Existing priced job", assigneeId: owner.id, scheduledAt: new Date(Date.now() - 40 * 86400000), status: "completed", totalAmount: 80, completedAt: new Date(Date.now() - 40 * 86400000),
    }).returning();

    const ownerApp = appFor(tenant.id, owner.id);
    const first = await request(ownerApp).get("/routes/daily").set("x-view-as", "technician");
    expect(first.status).toBe(200);
    expect(first.body.viewer).toMatchObject({ role: "company_owner", boardRole: "owner" });
    expect(first.body.capabilities).toMatchObject({ switchViews: true, simulateRole: true, reassign: true, optimizeAll: true });
    expect(first.body.crews).toHaveLength(3);
    expect(first.body.unassigned).toHaveLength(2);
    const callback = first.body.crews.flatMap((crew: { jobs: Array<{ isCallback: boolean; payout: number; callbackDeduction: number }> }) => crew.jobs)
      .find((job: { isCallback: boolean }) => job.isCallback);
    expect(callback).toMatchObject({ payout: 0, callbackDeduction: 35 });
    expect(JSON.stringify(first.body)).not.toContain("GOOGLE_MAPS_API_KEY");
    const names = new Set(first.body.crews.map((crew: { name: string }) => crew.name));
    expect(names).toEqual(new Set(["North Route", "South Route", "West Route"]));

    const second = await request(ownerApp).get("/routes/daily");
    expect(second.body.crews).toHaveLength(3);
    const [keptRow] = await db.select().from(jobsTable).where(eq(jobsTable.id, kept.id));
    expect(keptRow.totalAmount).toBe(80);
    expect(keptRow.title).toBe("Existing priced job");

    const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, tenant.id));
    const managerA = users.find(user => user.email.includes("manager-a"));
    const managerB = users.find(user => user.email.includes("manager-b"));
    const tech = users.find(user => user.email.includes("tech-north"));
    expect(managerA && managerB && tech).toBeTruthy();

    const crewView = await request(appFor(tenant.id, tech!.id)).get("/routes/daily").set("x-simulated-role", "company_owner");
    expect(crewView.status).toBe(200);
    expect(crewView.body.crews).toHaveLength(1);
    expect(crewView.body.crews[0].name).toBe("North Route");
    expect(crewView.body.unassigned).toHaveLength(0);
    expect(crewView.body.capabilities.switchViews).toBe(false);
    expect(crewView.body.capabilities.simulateRole).toBe(false);
    expect(JSON.stringify(crewView.body)).not.toContain("South Route");
    expect(JSON.stringify(crewView.body)).not.toContain("Rosa Garcia");

    const north = first.body.crews.find((crew: { name: string }) => crew.name === "North Route");
    const managerApp = appFor(tenant.id, managerA!.id);
    const managed = await request(managerApp).get("/routes/daily");
    expect(managed.body.crews.map((crew: { name: string }) => crew.name).sort()).toEqual(["North Route", "South Route"]);
    expect(managed.body.unassigned).toHaveLength(2);
    expect(managed.body.capabilities).toMatchObject({
      switchViews: true, reassign: false, logCallback: true, optimizeAll: true, simulateRole: false,
    });
    expect(JSON.stringify(managed.body)).not.toContain("West Route");

    const westId = first.body.crews.find((crew: { name: string }) => crew.name === "West Route").id;
    const south = managed.body.crews.find((crew: { name: string }) => crew.name === "South Route");
    const managerOptimized = await request(managerApp).post("/routes/daily/optimize-all").send({});
    expect(managerOptimized.status).toBe(200);
    expect(managerOptimized.body.routes.map((route: { crewId: number }) => route.crewId).sort()).toEqual([north.id, south.id].sort());
    const managerWestOptimize = await request(managerApp).post("/routes/optimize").send({
      origin: first.body.shop,
      destination: first.body.shop,
      crewId: westId,
      date: first.body.date,
      stops: [],
    });
    expect(managerWestOptimize.status).toBe(403);
    const crewOptimizeAll = await request(appFor(tenant.id, tech!.id)).post("/routes/daily/optimize-all").send({});
    expect(crewOptimizeAll.status).toBe(403);

    const other = await request(appFor(tenant.id, managerB!.id)).get("/routes/daily");
    expect(other.body.crews.map((crew: { name: string }) => crew.name)).toEqual(["West Route"]);
    expect(other.body.unassigned).toHaveLength(2);

    const previousKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    const optimized = await request(ownerApp).post("/routes/optimize").send({
      origin: first.body.shop,
      destination: first.body.shop,
      crewId: north.id,
      date: first.body.date,
      stops: north.jobs.map((job: { id: number; address: string; city: string; state: string; zip: string; lat: number; lng: number; status: string; lockedTimeWindow: boolean }) => ({
        id: job.id,
        address: [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "),
        status: job.status === "scheduled" ? "UPCOMING" : job.status,
        lockedTimeWindow: job.lockedTimeWindow,
        lat: job.lat,
        lng: job.lng,
      })),
    });
    if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousKey;
    expect(optimized.status).toBe(200);
    expect(optimized.body.source).toBe("estimated");
    expect(optimized.body.legs).toHaveLength(north.jobs.length + 1);
    expect(optimized.body.legs.at(-1).toId).toBeNull();
    expect(JSON.stringify(optimized.body)).not.toContain("AIza");

    const managerCallback = await request(managerApp).post("/routes/daily/callbacks").send({
      crewId: north.id,
      deductionAmount: 15,
      customerName: "Manager redo",
      address: "2 Extra St",
    });
    expect(managerCallback.status).toBe(201);
    const managerWestCallback = await request(managerApp).post("/routes/daily/callbacks").send({ crewId: westId, deductionAmount: 15 });
    expect(managerWestCallback.status).toBe(404);

    const denied = await request(appFor(tenant.id, tech!.id)).post("/routes/optimize").send({
      origin: first.body.shop,
      destination: first.body.shop,
      crewId: first.body.crews.find((crew: { name: string }) => crew.name === "West Route").id,
      date: first.body.date,
      stops: [],
    });
    expect(denied.status).toBe(403);

    const logged = await request(ownerApp).post("/routes/daily/callbacks").send({
      crewId: north.id,
      deductionAmount: 20,
      customerName: "Redo Lawn",
      address: "1 Extra St",
    });
    expect(logged.status).toBe(201);
    const techCallback = await request(appFor(tenant.id, tech!.id)).post("/routes/daily/callbacks").send({ crewId: north.id, deductionAmount: 10 });
    expect(techCallback.status).toBe(403);

    const movable = north.jobs.find((job: { status: string; crewId: number }) => job.status === "scheduled");
    const reassigned = await request(ownerApp).patch(`/routes/daily/jobs/${movable.id}`).send({ crewId: westId });
    expect(reassigned.status).toBe(200);
    const [moved] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, movable.id), eq(jobsTable.tenantId, tenant.id)));
    expect(moved.crewId).toBe(westId);
    const crewReassign = await request(appFor(tenant.id, tech!.id)).patch(`/routes/daily/jobs/${north.jobs[0].id}`).send({ crewId: westId });
    expect(crewReassign.status).toBe(403);
  });

  it("does not overwrite a company that already has a crew", async () => {
    await installDailyRouteSchema();
    const key = randomUUID();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Has Crew", slug: key }).returning();
    tenants.push(tenant.id);
    const [owner] = await db.insert(usersTable).values({
      tenantId: tenant.id, name: "Owner", email: `${key}@example.invalid`, role: "company_owner",
    }).returning();
    const [crew] = await db.insert(crewsTable).values({ tenantId: tenant.id, name: "Real Crew", managerId: owner.id }).returning();
    await db.insert(jobsTable).values({
      tenantId: tenant.id, title: "Real job", crewId: crew.id, assigneeId: owner.id, scheduledAt: new Date(), totalAmount: 40, status: "scheduled",
    });
    const result = await request(appFor(tenant.id, owner.id)).get("/routes/daily");
    expect(result.status).toBe(200);
    expect(result.body.crews).toHaveLength(1);
    expect(result.body.crews[0].name).toBe("Real Crew");
    const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, tenant.id));
    expect(users).toHaveLength(1);
  });
});
