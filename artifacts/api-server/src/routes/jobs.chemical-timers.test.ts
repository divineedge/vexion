/**
 * Confirms that rainfast and re-entry timers are computed correctly on job
 * completion when the chemical application references a named mixture (i.e. it
 * goes through the chemicalMixtureItemsTable join path, not the single-product
 * path).
 *
 * Strategy: mock @workspace/db so no real DB is needed.  The select sequence
 * mirrors the exact order that POST /jobs/:id/complete issues its queries:
 *   1. Fetch job description
 *   2. Fetch chemical applications on the job
 *   3. Fetch mixture items (leftJoin with products) for each mixture application
 *   4. Fetch customer autoInvoice flag (so the handler can exit early)
 *
 * The captured db.update call on chemicalApplicationsTable is inspected to
 * confirm rainfastUntil and reentryUntil match the *maximum* values across
 * all products in the mixture.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks (hoisted before any real imports) ───────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  jobsTable:                    { _t: "jobs" },
  customersTable:               { _t: "customers" },
  usersTable:                   { _t: "users" },
  propertiesTable:              { _t: "properties" },
  activityLogTable:             { _t: "activity_log" },
  inventoryItemsTable:          { _t: "inventory_items" },
  crewsTable:                   { _t: "crews" },
  customerAlertsTable:          { _t: "customer_alerts" },
  invoicesTable:                { _t: "invoices" },
  tenantsTable:                 { _t: "tenants" },
  blueprintsTable:              { _t: "blueprints" },
  chemicalApplicationsTable:    { _t: "chemical_applications" },
  chemicalProductsTable:        { _t: "chemical_products" },
  chemicalMixtureItemsTable:    { _t: "chemical_mixture_items" },
  customerPlansTable:           { _t: "customer_plans" },
  equipmentFuelLogsTable:       { _t: "equipment_fuel_logs" },
  routeTemplatesTable:          { _t: "route_templates" },
  skipReasonsTable:             { _t: "skip_reasons" },
  taskNotificationsTable:       { _t: "task_notifications" },
  internalTasksTable:           { _t: "internal_tasks" },
}));

vi.mock("../lib/roles", () => ({
  getCallerRole: vi.fn().mockResolvedValue("owner"),
  isAdminRole:   vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/tenantHelper", () => ({
  getTenantId: vi.fn().mockReturnValue(1),
  getUserId:   vi.fn().mockReturnValue(42),
}));

vi.mock("../lib/reminderScheduler", () => ({
  resendReminderForJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/billingScheduler", () => ({
  enqueueInvoiceEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/emailProvider", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/smsProvider", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/recurrenceEngine", () => ({
  nthOccurrenceAfterRoot: vi.fn().mockReturnValue(null),
  describeRule:           vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/importExport", () => ({
  importUpload:             { single: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()) },
  handleExportRequest:      vi.fn(),
  handleImportPreview:      vi.fn(),
  handleImportCommit:       vi.fn(),
  requireString:            vi.fn(),
  optionalString:           vi.fn(),
  optionalNumber:           vi.fn(),
  optionalDate:             vi.fn(),
  registerImportExportConfig: vi.fn(),
  encodeLineItemsCell:      vi.fn().mockReturnValue(""),
  decodeLineItemsCell:      vi.fn().mockReturnValue([]),
  sumLineItems:             vi.fn().mockReturnValue(0),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/stripeClient", () => ({
  getStripeClient: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db } from "@workspace/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

/**
 * Set up db.select to return sequential result arrays in call order.
 * Supports the chaining patterns used by jobs.ts:
 *   - select().from().where()
 *   - select().from().where().limit()
 *   - select().from().leftJoin().where()
 *   - select().from().orderBy()
 */
function setupSelectSequence(results: Array<Array<unknown>>) {
  let idx = 0;
  vi.mocked(db).select.mockImplementation(() => {
    const result = results[idx++] ?? [];

    // Terminal promise that also supports chaining
    const makeTerminal = () => {
      const p = Promise.resolve(result) as Promise<unknown[]> & {
        limit:   (n: number)         => Promise<unknown[]>;
        orderBy: (...a: unknown[])   => Promise<unknown[]>;
        where:   (...a: unknown[])   => Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]>; orderBy: (...a: unknown[]) => Promise<unknown[]> };
      };
      p.limit   = vi.fn().mockResolvedValue(result) as unknown as typeof p.limit;
      p.orderBy = vi.fn().mockResolvedValue(result) as unknown as typeof p.orderBy;
      p.where   = vi.fn().mockImplementation(makeTerminal) as unknown as typeof p.where;
      return p;
    };

    return {
      from: vi.fn().mockReturnValue({
        where:    vi.fn().mockImplementation(makeTerminal),
        orderBy:  vi.fn().mockResolvedValue(result),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(makeTerminal),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>;
  });
}

/**
 * Set up db.insert to silently consume every call (no return value needed).
 */
function setupInserts() {
  vi.mocked(db).insert.mockImplementation(() => {
    const p = Promise.resolve([{ id: 999 }]) as unknown as Promise<{ id: number }[]> & {
      returning: () => Promise<{ id: number }[]>;
    };
    const valuesFn = vi.fn().mockImplementation(() => {
      p.returning = vi.fn().mockResolvedValue([{ id: 999 }]) as unknown as typeof p.returning;
      return p;
    });
    return { values: valuesFn } as unknown as ReturnType<typeof db.insert>;
  });
}

/**
 * Set up db.update with sequential behaviours:
 *   - First call  (jobsTable): returns a full job row via .returning()
 *   - Subsequent calls: no-op set/where chain; captured for assertion
 *
 * Returns `capturedSets` — an array of the `.set(...)` argument for every
 * update call beyond the first, in order.
 */
function setupUpdates(jobRow: Record<string, unknown>): Array<Record<string, unknown>> {
  const capturedSets: Array<Record<string, unknown>> = [];
  let callCount = 0;

  vi.mocked(db).update.mockImplementation(() => {
    callCount++;
    const isJobUpdate = callCount === 1; // first update is always jobsTable

    if (isJobUpdate) {
      // Needs .set().where().returning() chain
      const whereFn = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([jobRow]),
      });
      const setFn = vi.fn().mockReturnValue({ where: whereFn });
      return { set: setFn } as unknown as ReturnType<typeof db.update>;
    }

    // Subsequent updates: capture the set() payload, resolve to empty
    const whereFn = vi.fn().mockResolvedValue([]);
    const setFn = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capturedSets.push(payload);
      return { where: whereFn };
    });
    return { set: setFn } as unknown as ReturnType<typeof db.update>;
  });

  return capturedSets;
}

// ── Shared test job row ───────────────────────────────────────────────────────

function makeJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    tenantId: 1,
    title: "Lawn Treatment",
    description: null,
    status: "completed",
    priority: "normal",
    customerId: 3,
    propertyId: null,
    assigneeId: null,
    crewId: null,
    blueprintId: null,
    invoiceId: null,
    invoiceAfterJob: false,
    estimateId: null,
    scheduledAt: new Date("2026-08-12T08:00:00Z"),
    completedAt: new Date("2026-08-12T10:00:00Z"),
    totalAmount: 150,
    lineItems: [],
    jobParts: [],
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceIndex: null,
    recurrenceCount: 0,
    isRecurrencePaused: false,
    resumeAt: null,
    pendingWeeklyInvoice: false,
    routeTemplateId: null,
    sequenceOrder: null,
    isOneTimeReschedule: false,
    originalScheduledDate: null,
    smsReminderEnabled: false,
    tags: [],
    skipReasonId: null,
    skipNote: null,
    cancellationRequestedAt: null,
    cancellationReason: null,
    estimatedDuration: null,
    holdFromBilling: false,
    serviceId: null,
    planId: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /jobs/:id/complete — chemical timer computation", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: jobsRouter } = await import("./jobs");
    app.use("/", jobsRouter);
  });

  it("sets rainfastUntil and reentryUntil to the max values across all products in a mixture", async () => {
    /**
     * Scenario:
     *   The job has one chemical application that uses a named mixture
     *   containing two products:
     *     Product A: rainfastHours=2,  rei=8
     *     Product B: rainfastHours=6,  rei=4
     *
     *   Expected timers (both relative to `now` captured inside the handler):
     *     rainfastUntil ≈ now + 6h   (max rainfastHours)
     *     reentryUntil  ≈ now + 8h   (max rei)
     *
     *   We bracket the request with before/after timestamps and allow a 5 s
     *   tolerance to account for test execution time.
     */
    const jobRow = makeJobRow();

    // Select call order:
    //  [0] fetch job description
    //  [1] fetch chemical applications on the job  → one app with mixtureId
    //  [2] fetch mixture items (leftJoin products) → two products with different timers
    //  [3] fetch customer autoInvoice flag         → disabled, so handler returns early
    setupSelectSequence([
      /* [0] description */ [{ description: null }],
      /* [1] applications */ [{ id: 55, productId: null, mixtureId: 12 }],
      /* [2] mixture items */ [
        { rainfastHours: 2, rei: 8 },  // Product A
        { rainfastHours: 6, rei: 4 },  // Product B
      ],
      /* [3] customer autoInvoice */ [{ autoInvoiceOnCompletion: false, email: "customer@example.com" }],
    ]);

    const capturedSets = setupUpdates(jobRow);
    setupInserts();

    const beforeMs = Date.now();
    const resp = await request(app)
      .post("/jobs/7/complete")
      .set({ "x-tenant-id": "1", "x-user-id": "42" });
    const afterMs = Date.now();

    expect(resp.status).toBe(200);

    // The first captured set after the job update is the chemical application update
    const chemicalUpdate = capturedSets[0];
    expect(chemicalUpdate).toBeDefined();
    expect(chemicalUpdate.rainfastUntil).toBeInstanceOf(Date);
    expect(chemicalUpdate.reentryUntil).toBeInstanceOf(Date);

    // rainfastUntil = now + max(2, 6) hours = now + 6h
    const rfMs = (chemicalUpdate.rainfastUntil as Date).getTime();
    expect(rfMs).toBeGreaterThanOrEqual(beforeMs + 6 * 3600 * 1000);
    expect(rfMs).toBeLessThanOrEqual(afterMs  + 6 * 3600 * 1000 + 5000);

    // reentryUntil = now + max(8, 4) hours = now + 8h
    const riMs = (chemicalUpdate.reentryUntil as Date).getTime();
    expect(riMs).toBeGreaterThanOrEqual(beforeMs + 8 * 3600 * 1000);
    expect(riMs).toBeLessThanOrEqual(afterMs  + 8 * 3600 * 1000 + 5000);
  });

  it("uses single-product rainfastHours and rei when the application references a product directly", async () => {
    /**
     * Sanity check: the simpler single-product path should also work correctly.
     *   Product: rainfastHours=4, rei=12
     */
    const jobRow = makeJobRow();

    setupSelectSequence([
      /* [0] description */ [{ description: null }],
      /* [1] applications */ [{ id: 56, productId: 99, mixtureId: null }],
      /* [2] product fetch */ [{ rainfastHours: 4, rei: 12 }],
      /* [3] customer autoInvoice */ [{ autoInvoiceOnCompletion: false, email: "customer@example.com" }],
    ]);

    const capturedSets = setupUpdates(jobRow);
    setupInserts();

    const beforeMs = Date.now();
    const resp = await request(app)
      .post("/jobs/7/complete")
      .set({ "x-tenant-id": "1", "x-user-id": "42" });
    const afterMs = Date.now();

    expect(resp.status).toBe(200);

    const chemicalUpdate = capturedSets[0];
    expect(chemicalUpdate).toBeDefined();
    expect(chemicalUpdate.rainfastUntil).toBeInstanceOf(Date);
    expect(chemicalUpdate.reentryUntil).toBeInstanceOf(Date);

    const rfMs = (chemicalUpdate.rainfastUntil as Date).getTime();
    expect(rfMs).toBeGreaterThanOrEqual(beforeMs + 4 * 3600 * 1000);
    expect(rfMs).toBeLessThanOrEqual(afterMs  + 4 * 3600 * 1000 + 5000);

    const riMs = (chemicalUpdate.reentryUntil as Date).getTime();
    expect(riMs).toBeGreaterThanOrEqual(beforeMs + 12 * 3600 * 1000);
    expect(riMs).toBeLessThanOrEqual(afterMs  + 12 * 3600 * 1000 + 5000);
  });

  it("handles a mixture where one product has no rainfast value — only the non-null product wins", async () => {
    /**
     * Product A: rainfastHours=null, rei=6
     * Product B: rainfastHours=3,    rei=null
     *
     * Expected: rainfastUntil ≈ now + 3h, reentryUntil ≈ now + 6h
     */
    const jobRow = makeJobRow();

    setupSelectSequence([
      /* [0] description */ [{ description: null }],
      /* [1] applications */ [{ id: 57, productId: null, mixtureId: 13 }],
      /* [2] mixture items */ [
        { rainfastHours: null, rei: 6 },
        { rainfastHours: 3,    rei: null },
      ],
      /* [3] customer autoInvoice */ [{ autoInvoiceOnCompletion: false, email: "customer@example.com" }],
    ]);

    const capturedSets = setupUpdates(jobRow);
    setupInserts();

    const beforeMs = Date.now();
    const resp = await request(app)
      .post("/jobs/7/complete")
      .set({ "x-tenant-id": "1", "x-user-id": "42" });
    const afterMs = Date.now();

    expect(resp.status).toBe(200);

    const chemicalUpdate = capturedSets[0];
    expect(chemicalUpdate).toBeDefined();
    expect(chemicalUpdate.rainfastUntil).toBeInstanceOf(Date);
    expect(chemicalUpdate.reentryUntil).toBeInstanceOf(Date);

    const rfMs = (chemicalUpdate.rainfastUntil as Date).getTime();
    expect(rfMs).toBeGreaterThanOrEqual(beforeMs + 3 * 3600 * 1000);
    expect(rfMs).toBeLessThanOrEqual(afterMs  + 3 * 3600 * 1000 + 5000);

    const riMs = (chemicalUpdate.reentryUntil as Date).getTime();
    expect(riMs).toBeGreaterThanOrEqual(beforeMs + 6 * 3600 * 1000);
    expect(riMs).toBeLessThanOrEqual(afterMs  + 6 * 3600 * 1000 + 5000);
  });

  it("skips the chemical timer update when no chemical applications exist on the job", async () => {
    /**
     * When there are no applications the timer block runs but has nothing to
     * iterate over, so chemicalApplicationsTable.update is never called.
     * The only non-job update in the handler is for blueprintsTable, which
     * must not carry rainfastUntil/reentryUntil.
     */
    const jobRow = makeJobRow();

    setupSelectSequence([
      /* [0] description */ [{ description: null }],
      /* [1] applications — empty */ [],
      /* [2] customer autoInvoice */ [{ autoInvoiceOnCompletion: false, email: "customer@example.com" }],
    ]);

    const capturedSets = setupUpdates(jobRow);
    setupInserts();

    const resp = await request(app)
      .post("/jobs/7/complete")
      .set({ "x-tenant-id": "1", "x-user-id": "42" });

    expect(resp.status).toBe(200);

    // Every captured set (blueprint etc.) must NOT have rainfast/reentry fields
    for (const s of capturedSets) {
      expect(s.rainfastUntil).toBeUndefined();
      expect(s.reentryUntil).toBeUndefined();
    }
  });
});
