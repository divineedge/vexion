import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, tenantsTable, usersTable, staffSessionsTable, equipmentTable, equipmentFuelLogsTable,
  bulkFuelTanksTable, bulkFuelTransactionsTable, expenseEntriesTable } from "@workspace/db";
import router from "./equipment";
import { dispenseBulkFuel } from "../lib/bulkFuel";
import { reconcileBulkFuel } from "../lib/bulkFuelAdjustment";

const app = express();
app.use(express.json());
app.use("/api", router);
const date = "2033-07-14";
const base = (id: number) => `/api/bulk-fuel/tanks/${id}/adjustments`;
const body = (measuredGallons = 80) => ({ measuredGallons, reason: "Gauge reconciliation after spill", date });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe("bulk tank reconciliation — real PostgreSQL and verified HTTP", () => {
  let tenant: number, foreignTenant: number, owner: number, token: string, employeeToken: string, foreignTank: number;
  let equipment: typeof equipmentTable.$inferSelect;
  const auth = () => ({ "x-staff-session": token });
  async function user(role: string) {
    const [row] = await db.insert(usersTable).values({
      tenantId: tenant, role, name: role, email: `adjust-${randomUUID()}@test.dev`, passwordHash: "integration",
    }).returning();
    const raw = randomUUID();
    await db.insert(staffSessionsTable).values({
      tenantId: tenant, userId: row.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return { row, raw };
  }
  async function tank(gallons = 100, cents = 30000) {
    const [row] = await db.insert(bulkFuelTanksTable).values({
      tenantId: tenant, name: "Integration tank", fuelType: "diesel", capacityThousandths: 200000,
    }).returning();
    if (gallons) {
      const intake = await request(app).post(`/api/bulk-fuel/tanks/${row.id}/intakes`).set(auth()).send({
        kind: "opening_balance", date, gallons, totalCost: cents / 100, idempotencyKey: randomUUID(),
      });
      expect(intake.status, JSON.stringify(intake.body)).toBe(201);
    }
    return row.id;
  }
  async function preview(id: number, measurement = 80) {
    const response = await request(app).post(`${base(id)}/preview`).set(auth()).send(body(measurement));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  }
  const commit = (id: number, data: any) => request(app).post(base(id)).set(auth()).send(data);
  const fuelRows = () => db.select().from(equipmentFuelLogsTable).where(eq(equipmentFuelLogsTable.tenantId, tenant));
  const expenses = () => db.select().from(expenseEntriesTable).where(eq(expenseEntriesTable.tenantId, tenant));
  async function stock(id: number) {
    const [row] = await db.select().from(bulkFuelTanksTable).where(eq(bulkFuelTanksTable.id, id));
    return row;
  }
  async function draw(tx: any, id: number, gallons = 10) {
    const [locked] = await tx.select().from(equipmentTable).where(eq(equipmentTable.id, equipment.id)).for("update");
    return dispenseBulkFuel(tx, { tenantId: tenant, equipment: locked, tankId: id, date,
      gallonsThousandths: gallons * 1000, jobId: null, odometerReading: null, idempotencyKey: randomUUID() });
  }
  beforeAll(async () => {
    [tenant, foreignTenant] = (await db.insert(tenantsTable).values([
      { name: `__adjustment_${randomUUID()}` }, { name: `__adjustment_foreign_${randomUUID()}` },
    ]).returning()).map(row => row.id);
    const manager = await user("company_owner"); owner = manager.row.id; token = manager.raw;
    employeeToken = (await user("technician")).raw;
    [equipment] = await db.insert(equipmentTable).values({ tenantId: tenant, name: "Reconciliation test equipment" }).returning();
    const [other] = await db.insert(bulkFuelTanksTable).values({ tenantId: foreignTenant, name: "Foreign", fuelType: "diesel" }).returning();
    foreignTank = other.id;
  });
  afterAll(async () => {
    for (const tenantId of [tenant, foreignTenant].filter(Boolean)) {
      await db.delete(bulkFuelTransactionsTable).where(eq(bulkFuelTransactionsTable.tenantId, tenantId));
      await db.delete(equipmentFuelLogsTable).where(eq(equipmentFuelLogsTable.tenantId, tenantId));
      await db.delete(bulkFuelTanksTable).where(eq(bulkFuelTanksTable.tenantId, tenantId));
      await db.delete(equipmentTable).where(eq(equipmentTable.tenantId, tenantId));
      await db.delete(staffSessionsTable).where(eq(staffSessionsTable.tenantId, tenantId));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
  });

  it("rejects spoofed identities, field staff, portal and cross-tenant requests", async () => {
    const id = await tank();
    for (const suffix of ["", "/preview"]) {
      const endpoint = base(id) + suffix;
      expect((await request(app).post(endpoint).set({ "x-user-id": String(owner), "x-tenant-id": String(tenant) }).send(body())).status).toBe(401);
      expect((await request(app).post(endpoint).set({ "x-staff-session": employeeToken }).send(body())).status).toBe(403);
      expect((await request(app).post(endpoint).set({ ...auth(), "x-portal-token": "forged" }).send(body())).status).toBe(403);
      expect((await request(app).post(base(foreignTank) + suffix).set(auth()).send({
        ...body(), expectedMovementId: 0, idempotencyKey: randomUUID(),
      })).status).toBe(404);
    }
  });

  it("previews without writes, snapshots verified actor, preserves costs and creates no expenses/logs", async () => {
    const id = await tank();
    await db.transaction(tx => draw(tx, id));
    const logsBefore = await fuelRows(); const expensesBefore = await expenses();
    const before = await stock(id);
    const p = await preview(id);
    expect(p).toMatchObject({ beforeGallons: 90, afterGallons: 80, gallonsChange: -10, beforeValue: 270, afterValue: 240, valueChange: -30 });
    expect(await stock(id)).toEqual(before);
    const data = { ...body(), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID(), actorId: -1, actorName: "spoof" };
    const saved = await commit(id, data);
    expect(saved.status).toBe(200);
    expect(saved.body.transaction).toMatchObject({ type: "adjustment", actorId: owner, actorName: "company_owner",
      reason: body().reason, gallons: -10, totalCost: -30, beforeGallons: 90, afterGallons: 80, beforeValue: 270, afterValue: 240,
      fuelLogId: null, equipmentId: null });
    const replay = await commit(id, data);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.transaction.id).toBe(saved.body.transaction.id);
    for (const changed of [{ measuredGallons: 79 }, { reason: "Different" }, { date: "2033-07-15" }, { expectedMovementId: 0 }]) {
      expect((await commit(id, { ...data, ...changed })).status).toBe(409);
    }
    expect(await fuelRows()).toEqual(logsBefore);
    expect(await expenses()).toEqual(expensesBefore);
    const history = await request(app).get(`/api/bulk-fuel/tanks/${id}/transactions`).set(auth());
    expect(history.body.data[0]).toEqual(saved.body.transaction);
    const totals = await db.execute(sql`select sum(gallons_thousandths)::int as qty, sum(total_cost_cents)::int as value from bulk_fuel_transactions where tank_id=${id}`);
    expect(totals.rows[0]).toEqual({ qty: 80000, value: 24000 });
  });

  it("handles weighted-average gains, exact emptying, precision and validation", async () => {
    const id = await tank(3, 1000);
    const p = await preview(id, 4);
    expect(p.afterValue).toBe(13.33);
    expect((await commit(id, { ...body(4), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() })).status).toBe(200);
    const empty = await preview(id, 0);
    expect(empty).toMatchObject({ afterValue: 0, valueChange: -13.33 });
    expect((await commit(id, { ...body(0), expectedMovementId: empty.expectedMovementId, idempotencyKey: randomUUID() })).status).toBe(200);
    expect(await stock(id)).toMatchObject({ availableThousandths: 0, inventoryValueCents: 0 });
    const gain = await request(app).post(`${base(id)}/preview`).set(auth()).send(body(1));
    expect(gain.status).toBe(400); expect(gain.body.error).toMatch(/valuation basis/);
    const full = await tank();
    for (const change of [{ measuredGallons: -1 }, { measuredGallons: null }, { measuredGallons: "5" },
      { measuredGallons: 201 }, { measuredGallons: 100 }, { reason: "  " }, { date: "2033-02-30" }]) {
      expect((await request(app).post(`${base(full)}/preview`).set(auth()).send({ ...body(), ...change })).status).toBe(400);
    }
    expect((await commit(full, { ...body(), idempotencyKey: randomUUID() })).status).toBe(400);
    await db.update(bulkFuelTanksTable).set({ isActive: false }).where(eq(bulkFuelTanksTable.id, full));
    expect((await request(app).post(`${base(full)}/preview`).set(auth()).send(body())).status).toBe(400);
    const free = await tank(10, 0);
    expect((await preview(free, 11)).afterValue).toBe(0);
  });

  it("serializes concurrent matching commits into a single movement", async () => {
    const id = await tank(); const p = await preview(id);
    const data = { ...body(), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() };
    const results = await Promise.all([commit(id, data), commit(id, data)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results.map(r => r.body.duplicate).sort()).toEqual([false, true]);
    expect(results[0].body.transaction.id).toBe(results[1].body.transaction.id);
  });

  it("invalidates previews after intake/adjustment and replays old success after subsequent stock changes", async () => {
    const id = await tank(); const p = await preview(id);
    const intakeKey = randomUUID();
    expect((await request(app).post(`/api/bulk-fuel/tanks/${id}/intakes`).set(auth()).send({
      kind: "delivery", date, gallons: 20, totalCost: 100, idempotencyKey: intakeKey,
    })).status).toBe(201);
    expect((await commit(id, { ...body(), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() })).status).toBe(409);
    const fresh = await preview(id);
    expect(fresh).toMatchObject({ beforeValue: 400, afterValue: 266.67 });
    expect((await commit(id, { ...body(), expectedMovementId: fresh.expectedMovementId, idempotencyKey: intakeKey })).status).toBe(409);
    const data = { ...body(), expectedMovementId: fresh.expectedMovementId, idempotencyKey: randomUUID() };
    const saved = await commit(id, data);
    expect(saved.status).toBe(200);
    expect((await commit(id, { ...data, idempotencyKey: randomUUID() })).status).toBe(409);
    await db.transaction(tx => draw(tx, id));
    const replay = await commit(id, data);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.transaction).toEqual(saved.body.transaction);
    expect(replay.body.tank.availableGallons).toBe(70);
    const otherManager = await user("office_manager");
    expect((await request(app).post(base(id)).set({ "x-staff-session": otherManager.raw }).send(data)).status).toBe(409);
  });

  it("rejects a stale confirmation blocked behind concurrent dispensing, without lost updates", async () => {
    const id = await tank(); const p = await preview(id);
    const held = deferred(); const release = deferred();
    const dispensing = db.transaction(async tx => { await draw(tx, id); held.resolve(); await release.promise; });
    await held.promise;
    let settled = false;
    const adjusting = commit(id, { ...body(), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() })
      .then(r => { settled = true; return r; });
    try {
      await new Promise(r => setTimeout(r, 100));
      expect(settled).toBe(false);
    } finally { release.resolve(); }
    await dispensing;
    const response = await adjusting;
    expect(response.status).toBe(409); expect(response.body.error).toMatch(/changed since preview/);
    expect(await stock(id)).toMatchObject({ availableThousandths: 90000, inventoryValueCents: 27000 });
  });

  it("dispensing waits for adjustment then allocates the adjusted stock, never negatives", async () => {
    const id = await tank(); const p = await preview(id, 5);
    const held = deferred(); const release = deferred();
    const adjustment = db.transaction(async tx => {
      await reconcileBulkFuel(tx, { tenantId: tenant, tankId: id, actorId: owner, actorName: "company_owner", commit: true,
        body: { ...body(5), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() } });
      held.resolve(); await release.promise;
    });
    await held.promise;
    let settled = false;
    const dispensing = db.transaction(tx => draw(tx, id, 10)).then(
      () => { settled = true; return "unexpected success"; }, e => { settled = true; return e.message; });
    try { await new Promise(r => setTimeout(r, 100)); expect(settled).toBe(false); }
    finally { release.resolve(); }
    await adjustment;
    expect(await dispensing).toMatch(/Insufficient/);
    expect(await stock(id)).toMatchObject({ availableThousandths: 5000, inventoryValueCents: 1500 });
    await db.transaction(tx => draw(tx, id, 5));
    expect(await stock(id)).toMatchObject({ availableThousandths: 0, inventoryValueCents: 0 });
  });

  it("rejects the original snapshot after a draw and reversal restore identical gallons and value", async () => {
    const id = await tank(); const p = await preview(id);
    const fill = await request(app).post(`/api/equipment/${equipment.id}/fuel-logs`).set(auth()).send({
      date, gallons: 10, fuelSource: "bulk_tank", bulkFuelTankId: id, idempotencyKey: randomUUID(),
    });
    expect(fill.status, JSON.stringify(fill.body)).toBe(201);
    const reversal = await request(app).delete(`/api/equipment/${equipment.id}/fuel-logs/${fill.body.id}`).set(auth());
    expect(reversal.status).toBe(204);
    expect(await stock(id)).toMatchObject({ availableThousandths: 100000, inventoryValueCents: 30000 });
    expect((await commit(id, { ...body(), expectedMovementId: p.expectedMovementId, idempotencyKey: randomUUID() })).status).toBe(409);
  });
});