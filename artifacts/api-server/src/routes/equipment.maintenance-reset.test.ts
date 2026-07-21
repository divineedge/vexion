/**
 * Tests for the maintenance-warning-clears-after-service-record edge case.
 *
 * Strategy: mock @workspace/db so no real DB is needed.
 *
 * Scenario: equipment whose currentHours exceed the old nextServiceDueHours (overdue)
 * has a new maintenance record posted with a higher nextServiceDueHours threshold.
 * After the new record exists, both GET /equipment/:id and GET /equipment must return
 * maintenanceDue: false and a positive hoursUntilService.
 *
 * Covers:
 * - GET /equipment/:id maintenanceDue resets to false once the new threshold is above currentHours
 * - GET /equipment/:id hoursUntilService is positive after the reset
 * - GET /equipment list reflects the same cleared state
 * - GET /equipment list hoursUntilService is positive for the reset item
 * - maintenanceDue stays true when the old (lower) schedule is still the latest
 * - nextServiceDueMiles reset mirrors the hours-based behaviour
 * - nextServiceDueDate reset mirrors the hours-based behaviour (date in future)
 * - All three thresholds overdue → new record clears all three simultaneously
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  equipmentTable: {},
  equipmentMaintenanceTable: {},
  equipmentFuelLogsTable: {},
  equipmentReadingLogsTable: {},
  equipmentLifecycleEventsTable: {},
  tenantsTable: {},
  usersTable: {},
  jobsTable: {},
  taskBundlesItemsTable: {},
  inventoryItemsTable: {},
}));

vi.mock("../lib/roles", () => ({
  isOwnerRole: vi.fn().mockResolvedValue(false),
}));

vi.mock("../lib/importExport", () => ({
  importUpload: {
    single: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  },
  handleExportRequest: vi.fn(),
  handleImportPreview: vi.fn(),
  handleImportCommit: vi.fn(),
  requireString: vi.fn(),
  optionalString: vi.fn().mockReturnValue(null),
  optionalNumber: vi.fn().mockReturnValue(null),
  optionalBoolean: vi.fn().mockReturnValue(null),
  registerImportExportConfig: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db } from "@workspace/db";

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

function tenantHeaders(tenantId = 1, userId = 1) {
  return { "x-tenant-id": String(tenantId), "x-user-id": String(userId) };
}

/** Mock a select chain where .from().where() resolves to `result`. */
function selectWhere(result: unknown[]) {
  const whereFn = vi.fn().mockResolvedValue(result);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

/** Mock a select chain where .from().where().orderBy() resolves to `result`. */
function selectWhereOrderBy(result: unknown[]) {
  const orderByFn = vi.fn().mockResolvedValue(result);
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

/** Tenant thresholds mock. */
function mockThresholds() {
  return selectWhere([{ repairPct: 50, resalePct: 20 }]);
}

/**
 * A base equipment DB row.
 * currentHours=500, currentMiles=20000.
 */
function makeEquipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    tenantId: 1,
    name: "Rider Mower",
    type: "mower",
    purchaseDate: "2019-01-01",
    purchasePrice: 8000,
    expectedLifespanYears: 10,
    expectedLifespanHours: 3000,
    currentHours: 500,
    currentMiles: 20000,
    totalRepairCost: 200,
    totalFuelCost: 100,
    isActive: true,
    archivedAt: null,
    notes: null,
    createdAt: new Date("2019-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Build a maintenance schedule row as returned by getScheduleMap's DB query.
 * At least one nextServiceDue* field must be non-null for getScheduleMap to keep it.
 */
function makeScheduleRow(overrides: {
  nextServiceDueHours?: number | null;
  nextServiceDueMiles?: number | null;
  nextServiceDueDate?: string | null;
}) {
  return {
    equipmentId: 7,
    date: "2025-06-01",
    createdAt: new Date("2025-06-01T00:00:00Z"),
    nextServiceDueHours: overrides.nextServiceDueHours ?? null,
    nextServiceDueMiles: overrides.nextServiceDueMiles ?? null,
    nextServiceDueDate: overrides.nextServiceDueDate ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Equipment maintenance warning reset", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: equipmentRouter } = await import("./equipment");
    app.use("/", equipmentRouter);
  });

  // ── Control: old schedule still overdue ─────────────────────────────────────

  it("GET /equipment/:id reports maintenanceDue=true when old threshold is still the latest", async () => {
    // currentHours=500, old threshold=400 → overdue
    const row = makeEquipmentRow({ currentHours: 500 });
    const oldSchedule = makeScheduleRow({ nextServiceDueHours: 400 }); // 400 < 500 → overdue

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))           // equipment row
      .mockReturnValueOnce(mockThresholds())              // tenant thresholds
      .mockReturnValueOnce(selectWhereOrderBy([oldSchedule])); // getScheduleMap

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(true);
    expect(resp.body.hoursUntilService).toBeLessThanOrEqual(0);
  });

  // ── Hours-based reset: GET /equipment/:id ───────────────────────────────────

  it("GET /equipment/:id returns maintenanceDue=false after new service record raises the hours threshold", async () => {
    // currentHours=500, new threshold=700 → not yet due
    const row = makeEquipmentRow({ currentHours: 500 });
    const newSchedule = makeScheduleRow({ nextServiceDueHours: 700 }); // 700 > 500 → cleared

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(false);
  });

  it("GET /equipment/:id returns a positive hoursUntilService after the maintenance warning clears", async () => {
    const row = makeEquipmentRow({ currentHours: 500 });
    const newSchedule = makeScheduleRow({ nextServiceDueHours: 700 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    // hoursUntilService = 700 - 500 = 200
    expect(resp.body.hoursUntilService).toBe(200);
    expect(resp.body.hoursUntilService).toBeGreaterThan(0);
  });

  // ── Hours-based reset: GET /equipment list ───────────────────────────────────

  it("GET /equipment list reflects maintenanceDue=false after the warning clears", async () => {
    const row = makeEquipmentRow({ currentHours: 500 });
    const newSchedule = makeScheduleRow({ nextServiceDueHours: 700 });

    // GET /equipment → Promise.all([list, thresholds, scheduleMap])
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([row]))    // equipment list
      .mockReturnValueOnce(mockThresholds())              // thresholds
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule])); // getScheduleMap

    const resp = await request(app).get("/equipment").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body).toHaveLength(1);
    expect(resp.body[0].maintenanceDue).toBe(false);
  });

  it("GET /equipment list returns a positive hoursUntilService after the warning clears", async () => {
    const row = makeEquipmentRow({ currentHours: 500 });
    const newSchedule = makeScheduleRow({ nextServiceDueHours: 700 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body[0].hoursUntilService).toBe(200);
    expect(resp.body[0].hoursUntilService).toBeGreaterThan(0);
  });

  // ── Miles-based reset ────────────────────────────────────────────────────────

  it("GET /equipment/:id clears maintenanceDue when nextServiceDueMiles is raised above currentMiles", async () => {
    // currentMiles=20000, new threshold=22000 → not yet due
    const row = makeEquipmentRow({ currentMiles: 20000 });
    const newSchedule = makeScheduleRow({ nextServiceDueMiles: 22000 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(false);
    // milesUntilService = 22000 - 20000 = 2000
    expect(resp.body.milesUntilService).toBe(2000);
    expect(resp.body.milesUntilService).toBeGreaterThan(0);
  });

  it("GET /equipment list clears maintenanceDue when nextServiceDueMiles is raised above currentMiles", async () => {
    const row = makeEquipmentRow({ currentMiles: 20000 });
    const newSchedule = makeScheduleRow({ nextServiceDueMiles: 22000 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body[0].maintenanceDue).toBe(false);
    expect(resp.body[0].milesUntilService).toBeGreaterThan(0);
  });

  // ── Date-based reset ─────────────────────────────────────────────────────────

  it("GET /equipment/:id clears maintenanceDue when nextServiceDueDate is set to a future date", async () => {
    // Use a date far in the future so the test is date-independent
    const futureDate = "2099-01-01";
    const row = makeEquipmentRow();
    const newSchedule = makeScheduleRow({ nextServiceDueDate: futureDate });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(false);
    expect(resp.body.nextServiceDueDate).toBe(futureDate);
  });

  it("GET /equipment list clears maintenanceDue when nextServiceDueDate is set to a future date", async () => {
    const futureDate = "2099-01-01";
    const row = makeEquipmentRow();
    const newSchedule = makeScheduleRow({ nextServiceDueDate: futureDate });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body[0].maintenanceDue).toBe(false);
  });

  // ── All-three thresholds overdue → new record clears all ──────────────────

  it("GET /equipment/:id clears maintenanceDue when all three thresholds are reset simultaneously", async () => {
    // All three thresholds overdue on old record; new record sets all three above current values
    const row = makeEquipmentRow({ currentHours: 500, currentMiles: 20000 });
    const newSchedule = makeScheduleRow({
      nextServiceDueHours: 700,   // 700 > 500
      nextServiceDueMiles: 22000, // 22000 > 20000
      nextServiceDueDate: "2099-01-01", // future
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(false);
    expect(resp.body.hoursUntilService).toBeGreaterThan(0);
    expect(resp.body.milesUntilService).toBeGreaterThan(0);
  });

  it("GET /equipment list clears maintenanceDue when all three thresholds are reset simultaneously", async () => {
    const row = makeEquipmentRow({ currentHours: 500, currentMiles: 20000 });
    const newSchedule = makeScheduleRow({
      nextServiceDueHours: 700,
      nextServiceDueMiles: 22000,
      nextServiceDueDate: "2099-01-01",
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([newSchedule]));

    const resp = await request(app).get("/equipment").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body[0].maintenanceDue).toBe(false);
    expect(resp.body[0].hoursUntilService).toBeGreaterThan(0);
    expect(resp.body[0].milesUntilService).toBeGreaterThan(0);
  });

  // ── Boundary: exactly at threshold is still due ──────────────────────────

  it("GET /equipment/:id still reports maintenanceDue=true when currentHours exactly equals nextServiceDueHours", async () => {
    // hoursUntilService = 500 - 500 = 0 → still due (≤ 0)
    const row = makeEquipmentRow({ currentHours: 500 });
    const schedule = makeScheduleRow({ nextServiceDueHours: 500 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([row]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(selectWhereOrderBy([schedule]));

    const resp = await request(app).get("/equipment/7").set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.maintenanceDue).toBe(true);
    expect(resp.body.hoursUntilService).toBe(0);
  });
});
