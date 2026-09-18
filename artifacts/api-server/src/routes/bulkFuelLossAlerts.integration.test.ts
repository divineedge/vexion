import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  bulkFuelTanksTable,
  bulkFuelTransactionsTable,
  db,
  staffSessionsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import router from "./equipment";

const app = express();
app.use(express.json());
app.use("/api", router);

describe("bulk fuel loss alerts — real PostgreSQL and verified HTTP", () => {
  let tenantId: number;
  let foreignTenantId: number;
  let tankId: number;
  let foreignTankId: number;
  let managerToken: string;
  let employeeToken: string;

  async function createUser(role: string) {
    const [user] = await db.insert(usersTable).values({
      tenantId, role, name: role, email: `fuel-loss-${randomUUID()}@test.dev`, passwordHash: "integration",
    }).returning();
    const token = randomUUID();
    await db.insert(staffSessionsTable).values({
      tenantId, userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return token;
  }

  async function adjustment(args: {
    tenant?: number; tank?: number; gallons: number; cents: number; createdAt?: Date;
  }) {
    const beforeThousandths = args.gallons < 0 ? Math.abs(args.gallons) + 10_000 : 10_000;
    const beforeValueCents = args.cents < 0 ? Math.abs(args.cents) + 2_000 : 2_000;
    await db.insert(bulkFuelTransactionsTable).values({
      tenantId: args.tenant ?? tenantId,
      tankId: args.tank ?? tankId,
      type: "adjustment",
      date: "2030-01-01",
      gallonsThousandths: args.gallons,
      totalCostCents: args.cents,
      reason: "Audited reconciliation",
      actorId: 1,
      actorName: "Manager",
      beforeThousandths,
      afterThousandths: beforeThousandths + args.gallons,
      beforeValueCents,
      afterValueCents: beforeValueCents + args.cents,
      expectedMovementId: 0,
      idempotencyKey: randomUUID(),
      createdAt: args.createdAt ?? new Date(),
    });
  }

  beforeAll(async () => {
    [tenantId, foreignTenantId] = (await db.insert(tenantsTable).values([
      { name: `__fuel_loss_${randomUUID()}` },
      { name: `__fuel_loss_foreign_${randomUUID()}` },
    ]).returning()).map(row => row.id);
    managerToken = await createUser("company_owner");
    employeeToken = await createUser("technician");
    [tankId, foreignTankId] = (await db.insert(bulkFuelTanksTable).values([
      { tenantId, name: "Main yard", fuelType: "diesel" },
      { tenantId: foreignTenantId, name: "Foreign yard", fuelType: "diesel" },
    ]).returning()).map(row => row.id);
  });

  afterAll(async () => {
    for (const id of [tenantId, foreignTenantId].filter(Boolean)) {
      await db.delete(bulkFuelTransactionsTable).where(eq(bulkFuelTransactionsTable.tenantId, id));
      await db.delete(bulkFuelTanksTable).where(eq(bulkFuelTanksTable.tenantId, id));
      await db.delete(staffSessionsTable).where(eq(staffSessionsTable.tenantId, id));
      await db.delete(usersTable).where(eq(usersTable.tenantId, id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
    }
  });

  const auth = (token = managerToken) => ({ "x-staff-session": token });

  it("defaults disabled and restricts every endpoint to tank managers", async () => {
    const settings = await request(app).get("/api/bulk-fuel/loss-alerts/settings").set(auth());
    expect(settings.status).toBe(200);
    expect(settings.body).toEqual({ periodDays: 30, gallonThreshold: null, valueThreshold: null });
    for (const path of ["/api/bulk-fuel/loss-alerts/settings", "/api/bulk-fuel/loss-alerts"]) {
      expect((await request(app).get(path).set(auth(employeeToken))).status).toBe(403);
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).put("/api/bulk-fuel/loss-alerts/settings")
      .set(auth(employeeToken)).send({ periodDays: 30, gallonThreshold: 1, valueThreshold: null })).status).toBe(403);
  });

  it("validates and persists tenant settings", async () => {
    expect((await request(app).put("/api/bulk-fuel/loss-alerts/settings").set(auth())
      .send({ periodDays: 0, gallonThreshold: null, valueThreshold: null })).status).toBe(400);
    const response = await request(app).put("/api/bulk-fuel/loss-alerts/settings").set(auth())
      .send({ periodDays: 7, gallonThreshold: 10, valueThreshold: 100 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ periodDays: 7, gallonThreshold: 10, valueThreshold: 100 });
  });

  it("aggregates only recent negative adjustment losses and strictly exceeds either threshold", async () => {
    await adjustment({ gallons: -6_000, cents: -6_000 });
    await adjustment({ gallons: -5_000, cents: -5_000 });
    await adjustment({ gallons: 2_000, cents: 2_000 });
    await adjustment({ gallons: -50_000, cents: -50_000, createdAt: new Date(Date.now() - 8 * 86_400_000) });
    await adjustment({ tenant: foreignTenantId, tank: foreignTankId, gallons: -50_000, cents: -50_000 });
    await db.insert(bulkFuelTransactionsTable).values({
      tenantId, tankId, type: "dispense", date: "2030-01-01",
      gallonsThousandths: -50_000, totalCostCents: -50_000, idempotencyKey: randomUUID(),
    });

    const response = await request(app).get("/api/bulk-fuel/loss-alerts").set(auth());
    expect(response.status).toBe(200);
    expect(response.body.alerts).toEqual([{
      tankId, tankName: "Main yard", lossGallons: 11, lossValue: 110, adjustmentCount: 2,
    }]);

    await request(app).put("/api/bulk-fuel/loss-alerts/settings").set(auth())
      .send({ periodDays: 7, gallonThreshold: 11, valueThreshold: 110 });
    expect((await request(app).get("/api/bulk-fuel/loss-alerts").set(auth())).body.alerts).toEqual([]);
  });
});