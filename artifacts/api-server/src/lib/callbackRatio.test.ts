/**
 * Regression tests for the shared callback ratio calculation.
 *
 * These tests guard against two failure modes that existed before the shared
 * callbackRatio.ts was introduced:
 *
 *  1. Divergence: GET /callbacks/stats and GET /efficiency returning different
 *     per-technician or company-wide callback ratios.
 *  2. The 0%-ratio bug: a technician with a logged callback showing 0% because
 *     the callback's originalAssigneeId did not match the jobs.assigneeId used
 *     for the completed-jobs denominator.
 *
 * Strategy: mock @workspace/db so no real DB is needed; control every
 * db.select / db.execute return value via mockReturnValueOnce so the exact
 * query sequence issued by each route is predictable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  callbacksTable: {},
  jobsTable: {},
  usersTable: {},
  timeEntriesTable: {},
  subTimersTable: {},
  activityLogTable: {},
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db } from "@workspace/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

function tenantHeaders(tenantId = 1, userId = 1) {
  return { "x-tenant-id": String(tenantId), "x-user-id": String(userId) };
}

/**
 * Build a fluent Drizzle-style select chain that resolves to `result` whether
 * the caller awaits the chain directly (`.where()` terminal) or calls
 * `.groupBy()` last. Any intermediate method (.from, .leftJoin, .where,
 * .groupBy) returns the same chain object.
 */
function makeSelectChain(result: unknown[]) {
  const resolved = Promise.resolve(result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn().mockResolvedValue(result),
    // Make the chain itself thenable so `await chain.where(...)` resolves
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      resolved.then(res, rej),
    catch: (rej: (e: unknown) => unknown) => resolved.catch(rej),
    finally: (fin: () => void) => resolved.finally(fin),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

/** Wrap rows in the shape Drizzle's db.execute returns. */
function rows<T>(data: T[]): { rows: T[] } {
  return { rows: data };
}

// ── Shared data fixtures ──────────────────────────────────────────────────────

/** Callback query rows (cbRows): one row per technician who has ≥1 callback. */
function makeCbRows(entries: Array<{ userId: number; name: string; count: number }>) {
  return entries.map(e => ({
    userId: e.userId,
    userName: e.name,
    callbackCount: e.count,
  }));
}

/** Job query rows (jobRows): one row per technician who has ≥1 completed job. */
function makeJobRows(entries: Array<{ userId: number; name: string; count: number }>) {
  return entries.map(e => ({
    userId: e.userId,
    userName: e.name,
    completedCount: e.count,
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Set up the two db.select calls that getCallbackRatioStats makes.
 * This is always done in the same order:
 *   1st select → cbRows (callbacks grouped by originalAssigneeId)
 *   2nd select → jobRows (completed jobs grouped by assigneeId)
 */
function mockCallbackRatioQueries(cbRows: unknown[], jobRows: unknown[]) {
  const dbSelect = db.select as ReturnType<typeof vi.fn>;
  dbSelect
    .mockReturnValueOnce(makeSelectChain(cbRows))
    .mockReturnValueOnce(makeSelectChain(jobRows));
}

/**
 * Set up ALL db calls the GET /efficiency handler makes (in order):
 *   1. db.select → clockRows  (timeEntriesTable, master clock)
 *   2. db.execute → subTimerRows  (raw SQL for job sub-timer seconds)
 *   3. db.select → cbRows  (inside getCallbackRatioStats)
 *   4. db.select → jobRows (inside getCallbackRatioStats)
 *   5. db.select → users   (usersTable name/role lookup)
 */
function mockEfficiencyQueries({
  clockRows,
  subTimerData,
  cbRows,
  jobRows,
  users,
}: {
  clockRows: unknown[];
  subTimerData: Array<{ user_id: number; job_seconds: number }>;
  cbRows: unknown[];
  jobRows: unknown[];
  users: Array<{ id: number; name: string; role: string }>;
}) {
  const dbSelect = db.select as ReturnType<typeof vi.fn>;
  dbSelect
    .mockReturnValueOnce(makeSelectChain(clockRows))  // 1. clock minutes
    .mockReturnValueOnce(makeSelectChain(cbRows))     // 3. callbacks
    .mockReturnValueOnce(makeSelectChain(jobRows))    // 4. completed jobs
    .mockReturnValueOnce(makeSelectChain(users));     // 5. user names/roles

  (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows(subTimerData)); // 2. sub-timers
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: /callbacks/stats returns correct ratios
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /callbacks/stats — callback ratio calculation", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: callbacksRouter } = await import("../routes/callbacks");
    app.use("/", callbacksRouter);
  });

  it("computes per-technician and company-wide callback ratios correctly", async () => {
    // Alice: 2 completed, 1 callback → 50%
    // Bob:   4 completed, 2 callbacks → 50%
    // Company: 3 / 6 = 50%
    mockCallbackRatioQueries(
      makeCbRows([
        { userId: 10, name: "Alice", count: 1 },
        { userId: 20, name: "Bob",   count: 2 },
      ]),
      makeJobRows([
        { userId: 10, name: "Alice", count: 2 },
        { userId: 20, name: "Bob",   count: 4 },
      ]),
    );

    const resp = await request(app).get("/callbacks/stats").set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { companyCallbackRatio, totalCallbacks, totalCompleted, technicians } = resp.body;

    const alice = technicians.find((t: { userId: number }) => t.userId === 10);
    expect(alice.callbackCount).toBe(1);
    expect(alice.completedJobs).toBe(2);
    expect(alice.callbackRatio).toBe(50);

    const bob = technicians.find((t: { userId: number }) => t.userId === 20);
    expect(bob.callbackCount).toBe(2);
    expect(bob.completedJobs).toBe(4);
    expect(bob.callbackRatio).toBe(50);

    expect(totalCallbacks).toBe(3);
    expect(totalCompleted).toBe(6);
    expect(companyCallbackRatio).toBe(50);
  });

  it("never returns 0% for a technician who has exactly one callback and one completed job", async () => {
    // This is the exact scenario that the 0%-ratio bug caused.
    // Carol has 1 callback attributed to her AND 1 completed job under her assigneeId.
    // The ratio must be 100% (1/1), never 0%.
    mockCallbackRatioQueries(
      makeCbRows([{ userId: 30, name: "Carol", count: 1 }]),
      makeJobRows([{ userId: 30, name: "Carol", count: 1 }]),
    );

    const resp = await request(app).get("/callbacks/stats").set(tenantHeaders());

    expect(resp.status).toBe(200);
    const carol = resp.body.technicians.find((t: { userId: number }) => t.userId === 30);
    expect(carol).toBeDefined();
    expect(carol.callbackRatio).not.toBe(0);
    expect(carol.callbackRatio).toBe(100);
  });

  it("returns 0% for a technician with completed jobs but zero callbacks", async () => {
    mockCallbackRatioQueries(
      makeCbRows([]),                                           // no callbacks
      makeJobRows([{ userId: 40, name: "Dave", count: 5 }]),
    );

    const resp = await request(app).get("/callbacks/stats").set(tenantHeaders());

    expect(resp.status).toBe(200);
    const dave = resp.body.technicians.find((t: { userId: number }) => t.userId === 40);
    expect(dave.callbackCount).toBe(0);
    expect(dave.callbackRatio).toBe(0);
    expect(dave.hasWarning).toBe(false);
  });

  it("returns 0 company ratio when there are no completed jobs", async () => {
    mockCallbackRatioQueries(makeCbRows([]), makeJobRows([]));

    const resp = await request(app).get("/callbacks/stats").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.companyCallbackRatio).toBe(0);
    expect(resp.body.totalCallbacks).toBe(0);
    expect(resp.body.totalCompleted).toBe(0);
  });

  it("flags a technician whose ratio exceeds the 10% warning threshold", async () => {
    // Eve: 3 callbacks / 5 completed = 60% → hasWarning: true
    mockCallbackRatioQueries(
      makeCbRows([{ userId: 50, name: "Eve", count: 3 }]),
      makeJobRows([{ userId: 50, name: "Eve", count: 5 }]),
    );

    const resp = await request(app).get("/callbacks/stats").set(tenantHeaders());

    expect(resp.status).toBe(200);
    const eve = resp.body.technicians.find((t: { userId: number }) => t.userId === 50);
    expect(eve.callbackRatio).toBe(60);
    expect(eve.hasWarning).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: /efficiency uses the same shared ratio — no divergence
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /efficiency — callback ratio matches /callbacks/stats", () => {
  let callbacksApp: ReturnType<typeof buildApp>;
  let efficiencyApp: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();

    callbacksApp = buildApp();
    const { default: callbacksRouter } = await import("../routes/callbacks");
    callbacksApp.use("/", callbacksRouter);

    efficiencyApp = buildApp();
    const { default: efficiencyRouter } = await import("../routes/efficiency");
    efficiencyApp.use("/", efficiencyRouter);
  });

  /**
   * For a given set of technician callback/job data, call both endpoints and
   * assert they return identical per-technician and company-wide callback ratios.
   */
  async function assertRatiosMatch(
    cbRows: ReturnType<typeof makeCbRows>,
    jobRows: ReturnType<typeof makeJobRows>,
    users: Array<{ id: number; name: string; role: "technician" | "crew_manager" }>,
  ) {
    // ── Hit /callbacks/stats ─────────────────────────────────────────────────
    mockCallbackRatioQueries(cbRows, jobRows);
    const statsResp = await request(callbacksApp).get("/callbacks/stats").set(tenantHeaders());
    expect(statsResp.status).toBe(200);

    // ── Hit /efficiency ──────────────────────────────────────────────────────
    mockEfficiencyQueries({
      clockRows: users.map(u => ({ userId: u.id, totalClockMinutes: 480 })),
      subTimerData: users.map(u => ({ user_id: u.id, job_seconds: 1200 })),
      cbRows,
      jobRows,
      users,
    });
    const effResp = await request(efficiencyApp).get("/efficiency?period=30d").set(tenantHeaders());
    expect(effResp.status).toBe(200);

    // ── Company-wide ratio must match exactly ─────────────────────────────────
    expect(effResp.body.companyCallbackRatio).toBe(statsResp.body.companyCallbackRatio);

    // ── Per-technician ratios must match exactly ──────────────────────────────
    for (const statsTech of statsResp.body.technicians as Array<{
      userId: number;
      callbackRatio: number;
      callbackCount: number;
      completedJobs: number;
    }>) {
      const effTech = (effResp.body.technicians as Array<{
        userId: number;
        callbackRatio: number;
        callbacks: number;
        completedJobs: number;
      }>).find(t => t.userId === statsTech.userId);

      if (!effTech) continue; // efficiency only shows technician/crew_manager roles

      expect(effTech.callbackRatio).toBe(statsTech.callbackRatio);
      expect(effTech.callbacks).toBe(statsTech.callbackCount);
      expect(effTech.completedJobs).toBe(statsTech.completedJobs);
    }
  }

  it("returns identical per-technician and company ratios across two technicians", async () => {
    const cbRows = makeCbRows([
      { userId: 10, name: "Alice", count: 1 },
      { userId: 20, name: "Bob",   count: 2 },
    ]);
    const jobRows = makeJobRows([
      { userId: 10, name: "Alice", count: 2 },
      { userId: 20, name: "Bob",   count: 4 },
    ]);
    const users = [
      { id: 10, name: "Alice", role: "technician" as const },
      { id: 20, name: "Bob",   role: "technician" as const },
    ];

    await assertRatiosMatch(cbRows, jobRows, users);
  });

  it("keeps ratio non-zero on /efficiency for the tech with 1 callback + 1 completed job", async () => {
    // This is the regression case: Carol's ratio must not collapse to 0% on either endpoint.
    const cbRows = makeCbRows([{ userId: 30, name: "Carol", count: 1 }]);
    const jobRows = makeJobRows([{ userId: 30, name: "Carol", count: 1 }]);
    const users = [{ id: 30, name: "Carol", role: "technician" as const }];

    mockEfficiencyQueries({
      clockRows: [{ userId: 30, totalClockMinutes: 480 }],
      subTimerData: [{ user_id: 30, job_seconds: 1200 }],
      cbRows,
      jobRows,
      users,
    });

    const effResp = await request(efficiencyApp).get("/efficiency?period=30d").set(tenantHeaders());
    expect(effResp.status).toBe(200);

    const carol = (effResp.body.technicians as Array<{ userId: number; callbackRatio: number }>)
      .find(t => t.userId === 30);
    expect(carol).toBeDefined();
    expect(carol!.callbackRatio).not.toBe(0);
    expect(carol!.callbackRatio).toBe(100);
  });

  it("shows 0% callback ratio on /efficiency for a tech with no callbacks", async () => {
    const cbRows = makeCbRows([]);
    const jobRows = makeJobRows([{ userId: 40, name: "Dave", count: 3 }]);
    const users = [{ id: 40, name: "Dave", role: "technician" as const }];

    mockEfficiencyQueries({
      clockRows: [{ userId: 40, totalClockMinutes: 480 }],
      subTimerData: [{ user_id: 40, job_seconds: 1200 }],
      cbRows,
      jobRows,
      users,
    });

    const effResp = await request(efficiencyApp).get("/efficiency?period=30d").set(tenantHeaders());
    expect(effResp.status).toBe(200);

    const dave = (effResp.body.technicians as Array<{ userId: number; callbackRatio: number; callbacks: number }>)
      .find(t => t.userId === 40);
    expect(dave).toBeDefined();
    expect(dave!.callbacks).toBe(0);
    expect(dave!.callbackRatio).toBe(0);
  });

  it("company-wide callback ratio on /efficiency matches /callbacks/stats with mixed data", async () => {
    // 3 technicians: 1 with callbacks, 1 without, 1 with many
    // Total: 4 callbacks / 8 completed = 50%
    const cbRows = makeCbRows([
      { userId: 10, name: "Alice", count: 1 },
      { userId: 30, name: "Carol", count: 3 },
    ]);
    const jobRows = makeJobRows([
      { userId: 10, name: "Alice", count: 2 },
      { userId: 20, name: "Bob",   count: 3 },
      { userId: 30, name: "Carol", count: 3 },
    ]);
    const users = [
      { id: 10, name: "Alice", role: "technician" as const },
      { id: 20, name: "Bob",   role: "technician" as const },
      { id: 30, name: "Carol", role: "crew_manager" as const },
    ];

    await assertRatiosMatch(cbRows, jobRows, users);
  });
});
