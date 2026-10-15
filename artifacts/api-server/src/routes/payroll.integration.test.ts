import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

// Every HTTP request uses one rollback-only connection. This exercises real
// SQL, rate triggers, schema validation, and routing without leaving payroll
// records in the development database or disabling immutable-record guards.
const holder = vi.hoisted(() => ({ connection: null as any, savepoint: 0 }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, {
    get(target, key) {
      if (key === "transaction" && holder.connection) return async (fn: any) => {
        const connection = holder.connection;
        const name = `payroll_fixture_${++holder.savepoint}`;
        await connection.execute(sql.raw(`SAVEPOINT ${name}`));
        try {
          const result = await fn(connection);
          await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
          return result;
        } catch (error) {
          await connection.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
          await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
          throw error;
        }
      };
      const current = holder.connection ?? target;
      const value = current[key];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) };
});
import { db, pool, tenantsTable, usersTable, servicesTable, jobsTable, timeEntriesTable, payrollRatesTable } from "@workspace/db";
import p4pRouter from "./p4p";

describe.skipIf(!(process.env.DATABASE_URL || process.env.PGHOST))("final payroll snapshots", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  let tenant: number, owner: number, tech: number, foreign: number, foreignOwner: number, service: number, period: number;
  let original: any;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      verifiedTenantId: req.headers["x-test-foreign"] ? foreign : tenant,
      verifiedUserId: req.headers["x-test-foreign"] ? foreignOwner : req.headers["x-test-tech"] ? tech : owner,
    });
    next();
  });
  app.use("/api", p4pRouter);
  app.use(((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
  const range = { dateFrom: "2020-01-02", dateTo: "2020-01-02" };
  const rate = async (source: string, sourceId: number, value: number | null, effectiveAt = "2020-01-01T00:00:00Z") =>
    db.insert(payrollRatesTable).values({ tenantId: tenant, source, sourceId, value, effectiveAt: new Date(effectiveAt) });

  beforeAll(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    holder.connection = drizzle(client);
    [tenant] = (await db.insert(tenantsTable).values({ name: "Payroll rollback fixture", timezone: "UTC", p4pMasterPercentage: 20 }).returning()).map(r => r.id);
    [foreign] = (await db.insert(tenantsTable).values({ name: "Foreign payroll fixture" }).returning()).map(r => r.id);
    const addUser = async (tenantId: number, role: string) => {
      const [u] = await db.insert(usersTable).values({ tenantId, role, name: role, email: `${role}-${tenantId}-${Date.now()}@payroll.invalid`, hourlyRate: 10 }).returning();
      return u.id;
    };
    owner = await addUser(tenant, "company_owner");
    tech = await addUser(tenant, "technician");
    foreignOwner = await addUser(foreign, "company_owner");
    [service] = (await db.insert(servicesTable).values({ tenantId: tenant, name: "Payroll fixture service", p4pPercentage: 25 }).returning()).map(r => r.id);
    await rate("hourly", tech, 10);
    await rate("hourly", tech, 20, "2020-01-02T12:00:00Z");
    await rate("service", service, 25);
    await rate("global", tenant, 20);
    await db.insert(timeEntriesTable).values({
      tenantId: tenant, userId: tech, clockedInAt: new Date("2020-01-02T10:00:00Z"),
      clockedOutAt: new Date("2020-01-02T14:00:00Z"), isMasterClock: true,
    });
    await db.insert(jobsTable).values({
      tenantId: tenant, title: "Payroll fixture job", status: "completed", completedAt: new Date("2020-01-02T14:00:00Z"),
      scheduledAt: new Date("2020-01-02T10:00:00Z"),
      assigneeId: tech, serviceId: service, totalAmount: 400,
    });
  });
  afterAll(async () => {
    holder.connection = null;
    if (client) { await client.query("ROLLBACK"); client.release(); }
  });

  it("prices mid-shift hourly changes and work-date P4P, then locks the server preview", async () => {
    const preview = await request(app).post("/api/p4p/payroll/preview").send(range);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const employee = preview.body.snapshot.summary.technicians.find((t: any) => t.userId === tech);
    expect(employee.clockHours).toBe(4);
    expect(employee.basePay).toBe(60);
    expect(employee.p4pEarnings).toBe(100);
    expect(employee.grossPay).toBe(100);
    expect(employee.rateSegments).toHaveLength(2);
    const approved = await request(app).post("/api/p4p/payroll/periods").send({ ...range, digest: preview.body.digest });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    period = approved.body.id; original = approved.body.snapshot;
    const listed = await request(app).get("/api/p4p/payroll/periods");
    expect(listed.body.find((p: any) => p.id === period)).toMatchObject({
      dateFrom: range.dateFrom, dateTo: range.dateTo, timezone: "UTC",
    });
  });

  it("keeps original rates and totals after employee, service, global, job and clock edits", async () => {
    await db.update(usersTable).set({ hourlyRate: 99, name: "Renamed tech" }).where(eq(usersTable.id, tech));
    await db.update(servicesTable).set({ p4pPercentage: 80 }).where(eq(servicesTable.id, service));
    await db.update(tenantsTable).set({ p4pMasterPercentage: 90 }).where(eq(tenantsTable.id, tenant));
    await db.update(jobsTable).set({ totalAmount: 900 }).where(eq(jobsTable.tenantId, tenant));
    await db.update(timeEntriesTable).set({ adjustedClockedOutAt: new Date("2020-01-02T15:00:00Z") }).where(eq(timeEntriesTable.tenantId, tenant));
    const saved = await request(app).get(`/api/p4p/payroll/periods/${period}`);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.snapshot).toEqual(original);
    const versions = await db.execute(sql`SELECT source, value FROM payroll_rates WHERE tenant_id=${tenant} AND effective_at > '2020-01-03'`);
    expect(versions.rows).toEqual(expect.arrayContaining([{ source: "hourly", value: 99 }, { source: "service", value: 80 }, { source: "global", value: 90 }]));
    const jobs = await request(app).get("/api/p4p/jobs?dateFrom=2020-01-02&dateTo=2020-01-02");
    expect(jobs.body[0].p4pPct).toBe(25);
  });

  it("requires separate signed, attributed corrections and preserves the original", async () => {
    for (const body of [{ userId: tech, amount: 1, reason: " " }, { userId: tech, amount: 0, reason: "Invalid" }, { userId: foreignOwner, amount: 2, reason: "Wrong tenant" }, { userId: tech, amount: 0.001, reason: "Precision" }]) {
      expect((await request(app).post(`/api/p4p/payroll/periods/${period}/adjustments`).send(body)).status).toBe(400);
    }
    const adjusted = await request(app).post(`/api/p4p/payroll/periods/${period}/adjustments`).send({ userId: tech, amount: -12.34, reason: "Correct duplicated pay" });
    expect(adjusted.status, JSON.stringify(adjusted.body)).toBe(201);
    expect(adjusted.body.createdBy).toBe(owner);
    const saved = await request(app).get(`/api/p4p/payroll/periods/${period}`);
    expect(saved.body.snapshot).toEqual(original);
    expect(saved.body.adjustments[0].amount).toBe(-12.34);
  });

  it("rejects overlapping approval, unreviewed changes, invalid dates and unauthorized access", async () => {
    const preview = await request(app).post("/api/p4p/payroll/preview").send(range);
    expect((await request(app).post("/api/p4p/payroll/periods").send({ ...range, digest: preview.body.digest })).status).toBe(409);
    const emptyRange = { dateFrom: "2020-01-04", dateTo: "2020-01-04" };
    expect((await request(app).post("/api/p4p/payroll/periods").send({ ...emptyRange, digest: "stale" })).status).toBe(409);
    expect((await request(app).post("/api/p4p/payroll/preview").send({ dateFrom: "2020-02-30", dateTo: "2020-03-01" })).status).toBe(400);
    expect((await request(app).post("/api/p4p/payroll/preview").send({ dateFrom: "2099-01-01", dateTo: "2099-01-02" })).status).toBe(400);
    expect((await request(app).get(`/api/p4p/payroll/periods/${period}`).set("x-test-foreign", "1")).status).toBe(404);
    expect((await request(app).get("/api/p4p/payroll/periods").set("x-test-tech", "1")).status).toBe(403);
    expect((await request(app).post(`/api/p4p/payroll/periods/${period}/adjustments`).set("x-test-tech", "1").send({ userId: tech, amount: 1, reason: "Forbidden" })).status).toBe(403);
  });

  it("enforces append-only records even for direct SQL writes", async () => {
    for (const table of ["payroll_periods", "payroll_adjustments", "payroll_rates"]) {
      await client.query("SAVEPOINT immutable_check");
      await expect(client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant])).rejects.toThrow("append-only");
      await client.query("ROLLBACK TO SAVEPOINT immutable_check");
      await client.query("RELEASE SAVEPOINT immutable_check");
    }
  });

  it("preserves cents near the adjustment limit on save, reload, and currency display", async () => {
    for (const amount of [999999.99, -999999.99, 1000000, -1000000]) {
      const saved = await request(app).post(`/api/p4p/payroll/periods/${period}/adjustments`).send({
        userId: tech, amount, reason: "Exact decimal precision regression",
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.amount).toBe(amount);
      const reloaded = await request(app).get(`/api/p4p/payroll/periods/${period}`);
      const adjustment = reloaded.body.adjustments.find((a: any) => a.id === saved.body.id);
      expect(adjustment.amount).toBe(amount);
      const expected = amount === 999999.99 ? "$999,999.99" : amount === -999999.99 ? "-$999,999.99" : amount > 0 ? "$1,000,000.00" : "-$1,000,000.00";
      expect(adjustment.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })).toBe(expected);
      const persisted = await client.query("SELECT amount::text FROM payroll_adjustments WHERE id=$1", [saved.body.id]);
      expect(persisted.rows[0].amount).toBe(amount.toFixed(2));
    }
  });

  it("recovers from missing historical rates through explicit audited P4P-only approval, never backdating today's rate", async () => {
    const [entry] = await db.insert(timeEntriesTable).values({
      tenantId: tenant, userId: tech, clockedInAt: new Date("2020-01-04T10:00:00Z"), isMasterClock: true,
    }).returning();
    const later = { dateFrom: "2020-01-04", dateTo: "2020-01-04" };
    const open = await request(app).post("/api/p4p/payroll/preview").send(later);
    expect(open.status).toBe(409);
    expect(open.body.error).toContain("Close outstanding");
    await db.update(timeEntriesTable).set({ clockedOutAt: new Date("2020-01-04T11:00:00Z") }).where(eq(timeEntriesTable.id, entry.id));
    await rate("hourly", tech, null, "2020-01-04T00:00:00Z");
    await db.insert(jobsTable).values({
      tenantId: tenant, title: "P4P-only work", status: "completed", completedAt: new Date("2020-01-04T11:00:00Z"),
      scheduledAt: new Date("2020-01-04T10:00:00Z"), assigneeId: tech, serviceId: service, totalAmount: 400,
    });
    const missing = await request(app).post("/api/p4p/payroll/preview").send(later);
    expect(missing.status, JSON.stringify(missing.body)).toBe(200);
    const employee = missing.body.snapshot.summary.technicians.find((t: any) => t.userId === tech);
    expect(employee).toMatchObject({ clockHours: 1, baseHourlyRate: null, basePay: null, grossPay: null, p4pEarnings: 100 });
    const input = { ...later, digest: missing.body.digest };
    const blocked = await request(app).post("/api/p4p/payroll/periods").send(input);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toContain("explicit reason");
    expect((await request(app).post("/api/p4p/payroll/periods").send({ ...input, p4pOnlyReason: "  " })).status).toBe(400);
    const approved = await request(app).post("/api/p4p/payroll/periods").send({ ...input, p4pOnlyReason: "Employee was paid on a P4P-only basis for this historical work." });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.snapshot.p4pOnlyApproval).toEqual({
      reason: "Employee was paid on a P4P-only basis for this historical work.", employeeIds: [tech],
    });
    const reloaded = await request(app).get(`/api/p4p/payroll/periods/${approved.body.id}`);
    expect(reloaded.body.snapshot).toEqual(approved.body.snapshot);
    expect(reloaded.body.approvedByName).toBe("company_owner");
    // An explicit later correction is now possible and leaves the original
    // unconfigured guarantee and P4P-only authorization unchanged.
    expect((await request(app).post(`/api/p4p/payroll/periods/${approved.body.id}/adjustments`).send({ userId: tech, amount: 25, reason: "Historical payroll correction" })).status).toBe(201);
    const corrected = await request(app).get(`/api/p4p/payroll/periods/${approved.body.id}`);
    expect(corrected.body.snapshot).toEqual(approved.body.snapshot);
    expect(corrected.body.adjustments[0].amount).toBe(25);
  });
  it("includes an owner's recorded work after field-work availability is turned off without changing approved payroll", async () => {
    await db.update(tenantsTable).set({ownersSchedulable:false}).where(eq(tenantsTable.id,tenant));
    await db.insert(timeEntriesTable).values({
      tenantId:tenant,userId:owner,isMasterClock:true,
      clockedInAt:new Date("2020-01-07T10:00:00Z"),clockedOutAt:new Date("2020-01-07T12:00:00Z"),
    });
    const preview=await request(app).post("/api/p4p/payroll/preview").send({dateFrom:"2020-01-07",dateTo:"2020-01-07"});
    expect(preview.status,JSON.stringify(preview.body)).toBe(200);
    const ownerRow=preview.body.snapshot.summary.technicians.find((u:{userId:number})=>u.userId===owner);
    expect(ownerRow).toBeTruthy();
    expect(ownerRow.clockHours).toBe(2);
    expect((await request(app).get(`/api/p4p/payroll/periods/${period}`)).body.snapshot).toEqual(original);
  });

  it("requires damage review, manually allocates employees, protects guarantees and freezes the report with payroll", async () => {
    const [employeeRecord] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, tech));
    const damageRange = { dateFrom: "2020-01-08", dateTo: "2020-01-08" };
    await rate("hourly", tech, 10, "2020-01-08T00:00:00Z");
    await rate("hourly", owner, 10, "2020-01-08T00:00:00Z");
    for (const userId of [tech, owner]) {
      await db.insert(timeEntriesTable).values({
        tenantId: tenant, userId, isMasterClock: true, clockedInAt: new Date("2020-01-08T10:00:00Z"), clockedOutAt: new Date("2020-01-08T14:00:00Z"),
      });
      await db.insert(jobsTable).values({
        tenantId: tenant, title: "Damage payroll fixture", assigneeId: userId, serviceId: service,
        status: "completed", totalAmount: 1000, scheduledAt: new Date("2020-01-08T10:00:00Z"), completedAt: new Date("2020-01-08T14:00:00Z"),
      });
    }
    const body = {
      title: "Verified damage", description: "Human-reviewed fixture incident", occurredOn: "2020-01-08", payrollDate: "2020-01-08",
      allocations: [{ userId: tech, amount: 20 }, { userId: owner, amount: 5 }],
    };
    const created = await request(app).post("/api/p4p/damage-reports").send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.allocations[0].employeeName).toBe(employeeRecord.name);
    const reportId = created.body.id;
    const first = await request(app).post("/api/p4p/payroll/preview").send(damageRange);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.snapshot.summary.technicians.find((t: any) => t.userId === tech).damageDeduction).toBe(0);
    const pending = await request(app).post("/api/p4p/payroll/periods").send({ ...damageRange, digest: first.body.digest });
    expect(pending.status).toBe(409);
    expect(pending.body.error).toContain("pending damage");
    const edited = await request(app).patch(`/api/p4p/damage-reports/${reportId}`).send({
      ...body, allocations: [{ userId: tech, amount: 40 }, { userId: owner, amount: 500 }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.allocations.map((a: any) => a.amount)).toEqual([40, 500]);
    const approved = await request(app).post(`/api/p4p/damage-reports/${reportId}/decision`).send({ action: "approve", reason: "Reviewed responsibility and amounts" });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.approvedByName).toBe("company_owner");
    expect(approved.body.decisionReason).toBe("Reviewed responsibility and amounts");
    expect((await request(app).post(`/api/p4p/damage-reports/${reportId}/decision`).send({ action: "approve", reason: "Duplicate attempt" })).status).toBe(409);
    expect((await request(app).patch(`/api/p4p/damage-reports/${reportId}`).send(body)).status).toBe(409);
    // A preview made before approval cannot silently finalize altered pay.
    expect((await request(app).post("/api/p4p/payroll/periods").send({ ...damageRange, digest: first.body.digest })).status).toBe(409);
    const preview = await request(app).post("/api/p4p/payroll/preview").send(damageRange);
    const technician = preview.body.snapshot.summary.technicians.find((t: any) => t.userId === tech);
    const ownerRow = preview.body.snapshot.summary.technicians.find((t: any) => t.userId === owner);
    expect(technician).toMatchObject({ p4pBeforeDamage: 250, damageDeduction: 40, p4pEarnings: 210, basePay: 40, grossPay: 210, damagePayReduction: 40, damageReportIds: [reportId] });
    expect(ownerRow).toMatchObject({ p4pBeforeDamage: 250, damageDeduction: 500, p4pEarnings: 0, basePay: 40, grossPay: 40, damagePayReduction: 210 });
    const ownSummary = await request(app).get("/api/p4p/summary?dateFrom=2020-01-08&dateTo=2020-01-08").set("x-test-tech", "1");
    expect(ownSummary.status, JSON.stringify(ownSummary.body)).toBe(200);
    expect(ownSummary.body.technicians).toHaveLength(1);
    expect(ownSummary.body.technicians[0]).toMatchObject({ userId: tech, p4pEarnings: 210 });
    const ownReports = await request(app).get("/api/p4p/damage-reports").set("x-test-tech", "1");
    expect(ownReports.body.find((r: any) => r.id === reportId).allocations).toEqual([{ userId: tech, employeeName: employeeRecord.name, amount: 40 }]);
    expect((await request(app).get("/api/p4p/damage-reports").set("x-test-foreign", "1")).body).toEqual([]);
    const outside = await request(app).get("/api/p4p/summary?dateFrom=2020-01-09&dateTo=2020-01-09");
    expect(outside.body.technicians.find((t: any) => t.userId === tech).damageDeduction).toBe(0);
    const finalized = await request(app).post("/api/p4p/payroll/periods").send({ ...damageRange, digest: preview.body.digest });
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(201);
    const stored = (await request(app).get("/api/p4p/damage-reports")).body.find((r: any) => r.id === reportId);
    expect(stored.payrollPeriodId).toBe(finalized.body.id);
    expect((await request(app).post(`/api/p4p/damage-reports/${reportId}/decision`).send({ action: "void", reason: "Must use payroll correction" })).status).toBe(409);
    await client.query("SAVEPOINT damage_immutable");
    await expect(client.query("UPDATE p4p_damage_reports SET title='Attempt' WHERE id=$1", [reportId])).rejects.toThrow("immutable");
    await client.query("ROLLBACK TO SAVEPOINT damage_immutable");
    await client.query("RELEASE SAVEPOINT damage_immutable");
    const reloaded = await request(app).get(`/api/p4p/payroll/periods/${finalized.body.id}`);
    expect(reloaded.body.snapshot).toEqual(finalized.body.snapshot);
    expect((await request(app).get(`/api/p4p/payroll/periods/${period}`)).body.snapshot).toEqual(original);
  });

  it("rejects invalid allocations and unauthorized writes, and records voids without deductions", async () => {
    const body = { title: "Void fixture", description: "Reviewed fixture", occurredOn: "2020-01-10", payrollDate: "2020-01-10", allocations: [{ userId: tech, amount: 12.34 }] };
    for (const patch of [
      { allocations: [{ userId: foreignOwner, amount: 1 }] },
      { allocations: [{ userId: tech, amount: 1 }, { userId: tech, amount: 2 }] },
      { allocations: [{ userId: tech, amount: -1 }] },
      { allocations: [{ userId: tech, amount: 1.001 }] },
      { occurredOn: "2020-02-30" },
    ]) expect((await request(app).post("/api/p4p/damage-reports").send({ ...body, ...patch })).status).toBe(400);
    expect((await request(app).post("/api/p4p/damage-reports").set("x-test-tech", "1").send(body)).status).toBe(403);
    const created = await request(app).post("/api/p4p/damage-reports").send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    expect((await request(app).post(`/api/p4p/damage-reports/${id}/decision`).set("x-test-foreign", "1").send({ action: "approve", reason: "Foreign" })).status).toBe(404);
    expect((await request(app).post(`/api/p4p/damage-reports/${id}/decision`).send({ action: "approve", reason: "" })).status).toBe(400);
    expect((await request(app).post(`/api/p4p/damage-reports/${id}/decision`).send({ action: "approve", reason: "Reviewed" })).status).toBe(200);
    const voided = await request(app).post(`/api/p4p/damage-reports/${id}/decision`).send({ action: "void", reason: "Not employee-caused" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: "void", voidReason: "Not employee-caused", approvedByName: "company_owner", voidedByName: "company_owner" });
    const summary = await request(app).get("/api/p4p/summary?dateFrom=2020-01-10&dateTo=2020-01-10");
    expect(summary.body.technicians.find((t: any) => t.userId === tech).damageDeduction).toBe(0);
    const closed = await request(app).post("/api/p4p/damage-reports").send({ ...body, payrollDate: range.dateFrom });
    expect((await request(app).post(`/api/p4p/damage-reports/${closed.body.id}/decision`).send({ action: "approve", reason: "Too late" })).status).toBe(409);
  });

  it("does not allow P4P-only authorization to bypass an unknown hourly guarantee for damage deductions", async () => {
    await rate("hourly", tech, null, "2020-01-11T00:00:00Z");
    await db.insert(timeEntriesTable).values({
      tenantId: tenant, userId: tech, isMasterClock: true, clockedInAt: new Date("2020-01-11T10:00:00Z"), clockedOutAt: new Date("2020-01-11T12:00:00Z"),
    });
    const created = await request(app).post("/api/p4p/damage-reports").send({
      title: "Unknown guarantee", description: "Fixture", occurredOn: "2020-01-11", payrollDate: "2020-01-11", allocations: [{ userId: tech, amount: 5 }],
    });
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/p4p/damage-reports/${created.body.id}/decision`).send({ action: "approve", reason: "Reviewed" })).status).toBe(200);
    const unknownRange = { dateFrom: "2020-01-11", dateTo: "2020-01-11" };
    const preview = await request(app).post("/api/p4p/payroll/preview").send(unknownRange);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const result = await request(app).post("/api/p4p/payroll/periods").send({ ...unknownRange, digest: preview.body.digest, p4pOnlyReason: "Cannot waive guarantee protection" });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("hourly guarantee is unknown");
  });
  it("matches damage dates, job earnings and clock guarantees in company time across daylight saving", async () => {
    await db.update(tenantsTable).set({ timezone: "America/Denver" }).where(eq(tenantsTable.id, tenant));
    await rate("hourly", tech, 10, "2020-03-01T00:00:00Z");
    await db.insert(timeEntriesTable).values({
      tenantId: tenant, userId: tech, isMasterClock: true,
      clockedInAt: new Date("2020-03-08T07:00:00Z"), clockedOutAt: new Date("2020-03-09T06:00:00Z"),
    });
    for (const [completedAt, totalAmount] of [["2020-03-08T06:59:00Z", 7000], ["2020-03-09T05:00:00Z", 1000]] as const) {
      await db.insert(jobsTable).values({
        tenantId: tenant, title: "Tenant day boundary", assigneeId: tech, serviceId: service,
        status: "completed", totalAmount, scheduledAt: new Date(completedAt), completedAt: new Date(completedAt),
      });
    }
    const created = await request(app).post("/api/p4p/damage-reports").send({
      title: "DST date allocation", description: "Fixture", occurredOn: "2020-03-08", payrollDate: "2020-03-08", allocations: [{ userId: tech, amount: 20 }],
    });
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/p4p/damage-reports/${created.body.id}/decision`).send({ action: "approve", reason: "Company calendar day" })).status).toBe(200);
    const live = await request(app).get("/api/p4p/summary?dateFrom=2020-03-08&dateTo=2020-03-08");
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    const employee = live.body.technicians.find((t: any) => t.userId === tech);
    expect(employee).toMatchObject({
      clockHours: 23, basePay: 230, p4pBeforeDamage: 250, damageDeduction: 20, p4pEarnings: 230,
      grossPay: 230, damagePayReduction: 20, damageReportIds: [created.body.id],
    });
    const preview = await request(app).post("/api/p4p/payroll/preview").send({ dateFrom: "2020-03-08", dateTo: "2020-03-08" });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.snapshot.summary.technicians.find((t: any) => t.userId === tech)).toEqual(employee);
  });
});
