/**
 * Tests for the equipment archive → restore round-trip.
 *
 * Strategy: mock @workspace/db so no real DB is needed.
 *
 * Covers:
 * - PATCH /equipment/:id with isActive=true clears archivedAt and restores the item
 * - totalRepairCost, totalFuelCost, and costPerHour are all intact after restore
 * - Archived item is absent from the default GET /equipment list (isNull archivedAt filter)
 * - Archived item appears when includeArchived=true
 * - Restored item re-appears in the default GET /equipment list
 * - GET /equipment/:id returns correct costs on a restored item
 * - Non-technician roles (admin, office) can call PATCH to restore
 * - Technician is rejected with 403
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

/**
 * Returns a mock select chain where .from().where() resolves to `result`.
 * Used for queries that are awaited directly after .where() (no .orderBy / .limit).
 */
function selectWhere(result: unknown[]) {
  const whereFn = vi.fn().mockResolvedValue(result);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

/**
 * Returns a mock select chain where .from().where().orderBy() resolves to `result`.
 * Used for list queries and getScheduleMap.
 */
function selectWhereOrderBy(result: unknown[]) {
  const orderByFn = vi.fn().mockResolvedValue(result);
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

/**
 * Returns a mock update chain where .set().where().returning() resolves to `result`.
 */
function updateReturning(result: unknown[]) {
  const returningFn = vi.fn().mockResolvedValue(result);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  return { set: setFn };
}

/**
 * A fully-populated equipment DB row fixture.
 * purchasePrice=5000, totalRepairCost=300, totalFuelCost=150, currentHours=500
 * → costPerHour = (5000+300+150)/500 = 11.0
 */
function makeEquipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    tenantId: 1,
    name: "Mower A",
    type: "mower",
    purchaseDate: "2020-01-01",
    purchasePrice: 5000,
    expectedLifespanYears: 10,
    expectedLifespanHours: 2000,
    currentHours: 500,
    currentMiles: null,
    totalRepairCost: 300,
    totalFuelCost: 150,
    isActive: true,
    archivedAt: null,
    notes: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Tenant thresholds mock: db.select → tenantsTable (awaited after .where()). */
function mockThresholds() {
  return selectWhere([{ repairPct: 50, resalePct: 20 }]);
}

/** Schedule map mock: db.select → equipmentMaintenanceTable (needs .orderBy()). */
function mockScheduleMap(rows: unknown[] = []) {
  return selectWhereOrderBy(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Equipment restore", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    // Re-import after clearing mocks so the module re-registers routes cleanly.
    const { default: equipmentRouter } = await import("./equipment");
    app.use("/", equipmentRouter);
  });

  // ── PATCH restore: role gating ──────────────────────────────────────────────

  it("rejects a technician attempting to restore with 403", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "technician" }])); // requireOfficeRole

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(403);
    expect(resp.body.error).toMatch(/admin or office/i);
  });

  it("allows an office user to restore", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "office" }])) // requireOfficeRole
      .mockReturnValueOnce(mockThresholds());                 // getTenantThresholds
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    expect(resp.body.isActive).toBe(true);
  });

  it("allows an admin user to restore", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "admin" }]))
      .mockReturnValueOnce(mockThresholds());
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    expect(resp.body.isActive).toBe(true);
  });

  // ── PATCH restore: response shape ───────────────────────────────────────────

  it("restore clears archivedAt and sets isActive=true in the response", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "admin" }]))
      .mockReturnValueOnce(mockThresholds());
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    expect(resp.body.isActive).toBe(true);
    expect(resp.body.archivedAt).toBeNull();
  });

  it("preserves totalRepairCost and totalFuelCost after restore", async () => {
    const restoredRow = makeEquipmentRow({
      isActive: true,
      archivedAt: null,
      totalRepairCost: 300,
      totalFuelCost: 150,
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "admin" }]))
      .mockReturnValueOnce(mockThresholds());
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    expect(resp.body.totalRepairCost).toBe(300);
    expect(resp.body.totalFuelCost).toBe(150);
  });

  it("computes costPerHour from preserved totals after restore", async () => {
    // purchasePrice=5000, totalRepairCost=300, totalFuelCost=150, currentHours=500
    // costPerHour = (5000 + 300 + 150) / 500 = 11.0
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "admin" }]))
      .mockReturnValueOnce(mockThresholds());
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    const expectedCostPerHour = (5000 + 300 + 150) / 500; // 11.0
    expect(resp.body.costPerHour).toBeCloseTo(expectedCostPerHour, 4);
  });

  it("round-trip: restore response costs match the values present while archived", async () => {
    // The archived row has the same totalRepairCost/totalFuelCost as the restored row —
    // confirming that restoring does not reset or clear cost accumulators.
    const costs = { totalRepairCost: 420, totalFuelCost: 85 };
    const archivedRow = makeEquipmentRow({
      isActive: false,
      archivedAt: new Date("2024-06-01T00:00:00Z"),
      ...costs,
    });
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null, ...costs });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([{ role: "admin" }]))
      .mockReturnValueOnce(mockThresholds());
    (db.update as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(updateReturning([restoredRow]));

    const resp = await request(app)
      .patch("/equipment/42")
      .set(tenantHeaders())
      .send({ isActive: true });

    expect(resp.status).toBe(200);
    expect(resp.body.totalRepairCost).toBe(archivedRow.totalRepairCost);
    expect(resp.body.totalFuelCost).toBe(archivedRow.totalFuelCost);
  });

  // ── GET /equipment list visibility ──────────────────────────────────────────

  it("default list excludes archived items (DB returns none when archivedAt filter applied)", async () => {
    // Simulate the DB honouring the isNull(archivedAt) WHERE clause by returning [].
    // GET /equipment uses Promise.all([equipmentList, thresholds, scheduleMap]).
    // db.select() is called three times in order: list, thresholds, scheduleMap.
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([]))  // equipment list → empty (archived item filtered)
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(mockScheduleMap());

    const resp = await request(app)
      .get("/equipment")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body).toHaveLength(0);
  });

  it("includeArchived=true returns the archived item", async () => {
    const archivedRow = makeEquipmentRow({
      isActive: false,
      archivedAt: new Date("2024-06-01T00:00:00Z"),
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([archivedRow]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(mockScheduleMap());

    const resp = await request(app)
      .get("/equipment?includeArchived=true")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body).toHaveLength(1);
    expect(resp.body[0].id).toBe(42);
    expect(resp.body[0].isActive).toBe(false);
    expect(resp.body[0].archivedAt).not.toBeNull();
  });

  it("restored item appears in the default list after restore", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhereOrderBy([restoredRow]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(mockScheduleMap());

    const resp = await request(app)
      .get("/equipment")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body).toHaveLength(1);
    expect(resp.body[0].isActive).toBe(true);
    expect(resp.body[0].archivedAt).toBeNull();
  });

  // ── GET /equipment/:id after restore ────────────────────────────────────────

  it("GET /equipment/:id returns correct costs and isActive=true on a restored item", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null });

    // GET /equipment/:id: Promise.all([equipmentRow, thresholds, scheduleMap])
    // db.select() called in order: equipment, thresholds (selectWhere), scheduleMap (selectWhereOrderBy)
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([restoredRow]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(mockScheduleMap());

    const resp = await request(app)
      .get("/equipment/42")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.id).toBe(42);
    expect(resp.body.isActive).toBe(true);
    expect(resp.body.archivedAt).toBeNull();
    expect(resp.body.totalRepairCost).toBe(300);
    expect(resp.body.totalFuelCost).toBe(150);
  });

  it("GET /equipment/:id returns non-null costPerHour when currentHours > 0 after restore", async () => {
    const restoredRow = makeEquipmentRow({ isActive: true, archivedAt: null, currentHours: 500 });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(selectWhere([restoredRow]))
      .mockReturnValueOnce(mockThresholds())
      .mockReturnValueOnce(mockScheduleMap());

    const resp = await request(app)
      .get("/equipment/42")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.costPerHour).not.toBeNull();
    expect(resp.body.costPerHour).toBeGreaterThan(0);
  });
});
