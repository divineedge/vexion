import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const transaction = vi.fn();
const select = vi.fn();
const insert = vi.fn();
const callerRole = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select, transaction, update: vi.fn(), insert, delete: vi.fn() },
  equipmentTable: {}, equipmentMaintenanceTable: {}, equipmentFuelLogsTable: {},
  equipmentReadingLogsTable: {}, equipmentLifecycleEventsTable: {}, tenantEquipmentTypesTable: {},
  bulkFuelTanksTable: {}, bulkFuelTransactionsTable: {},
  tenantsTable: {}, usersTable: {}, jobsTable: {}, taskBundlesItemsTable: {}, inventoryItemsTable: {},
  internalTasksTable: {}, crewsTable: {}, crewMembersTable: {},
  equipmentInspectionsTable: {}, equipmentInspectionReviewsTable: {},
}));
vi.mock("../lib/roles", () => ({ isOwnerRole: vi.fn(), getCallerRole: callerRole, ADMIN_ROLES: new Set(["company_owner", "office_manager", "department_manager"]) }));
vi.mock("../lib/verifiedStaff", () => ({
  requireVerifiedStaff: (req: { verifiedTenantId?: number; verifiedUserId?: number }, _res: unknown, next: () => void) => {
    req.verifiedTenantId = 1;
    req.verifiedUserId = 2;
    next();
  },
}));
vi.mock("../lib/importExport", () => ({
  importUpload: { single: vi.fn().mockReturnValue((_a: unknown, _b: unknown, next: () => void) => next()) },
  handleExportRequest: vi.fn(), handleImportPreview: vi.fn(), handleImportCommit: vi.fn(),
  requireString: vi.fn(), optionalString: vi.fn(), optionalNumber: vi.fn(), optionalBoolean: vi.fn(),
  registerImportExportConfig: vi.fn(),
}));

const input = { idempotencyKey: "retry-key", equipmentId: 7, condition: "good", fuelGallons: 2, readingType: "hours", readingValue: 12 };
const headers = { "x-tenant-id": "1", "x-user-id": "2" };
const whereResult = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
const authorizeAsAdmin = () => {
  select
    .mockReturnValueOnce(whereResult([{ id: 7, assignedUserId: null, assignedCrewId: null }]))
    .mockReturnValueOnce(whereResult([{ role: "company_owner" }]));
};

describe("POST /equipment/pre-trip", () => {
  beforeEach(() => { vi.clearAllMocks(); select.mockReset(); select.mockReturnValue(whereResult([])); transaction.mockReset(); insert.mockReset(); callerRole.mockReset(); });

  it("records a manager review using verified identity without assigning a task", async () => {
    callerRole.mockResolvedValue("company_owner");
    authorizeAsAdmin();
    select.mockReturnValueOnce(whereResult([{ id: 11, contextId: 7 }]));
    const captured: any[] = [];
    insert.mockReturnValue({ values: (value: any) => { captured.push(value); return { returning: () => Promise.resolve([{ id: 31, createdAt: new Date("2026-10-12T12:00:00Z") }]) }; } });
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/7/inspections/inspection-11/review").send({ notes: " Checked fuel and condition. ", reviewedById: 999 });
    expect(response.status).toBe(201);
    expect(captured).toEqual([{ tenantId: 1, inspectionRef: "inspection-11", reviewedById: 2, notes: "Checked fuel and condition." }]);
    expect(response.body.reviewedAt).toBe("2026-10-12T12:00:00.000Z");
  });

  it("blocks technician review before any record is written", async () => {
    callerRole.mockResolvedValue("technician");
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/7/inspections/inspection-11/review").send({ notes: "Reviewed" });
    expect(response.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("returns the prior successful task and performs no duplicate transaction", async () => {
    authorizeAsAdmin();
    const fingerprint = JSON.stringify({ equipmentId: 7, condition: "good", inspectionType: "pre_trip", fuelGallons: 2000, fuelSource: "purchased", bulkFuelTankId: null, purchasedFuelCents: 0, readingType: "hours", readingValue: 12, concerns: null, checklist: [] });
    select
      .mockReturnValueOnce(whereResult([{ preTripChecklist: [], endOfDayChecklist: [], timezone: "UTC" }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([{ id: 99, contextType: "equipment", contextId: 7, preTripRequestFingerprint: fingerprint }]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send(input);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ taskId: 99, duplicate: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects reuse of a pre-trip retry key when normalized request content changed", async () => {
    authorizeAsAdmin();
    const original = JSON.stringify({ equipmentId: 7, condition: "good", inspectionType: "pre_trip", fuelGallons: 2000, fuelSource: "purchased", bulkFuelTankId: null, purchasedFuelCents: 0, readingType: "hours", readingValue: 12, concerns: null, checklist: [] });
    select
      .mockReturnValueOnce(whereResult([{ preTripChecklist: [], endOfDayChecklist: [], timezone: "UTC" }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([{ id: 99, contextType: "equipment", contextId: 7, preTripRequestFingerprint: original }]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send({ ...input, condition: "unsafe" });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/idempotency key/i);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("creates exactly one bulk fuel log and one tank dispense in a pre-trip", async () => {
    authorizeAsAdmin();
    select
      .mockReturnValueOnce(whereResult([{ preTripChecklist: [], endOfDayChecklist: [], timezone: "UTC" }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([]));
    const inserted: any[] = [];
    transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => {
      let selects = 0; let inserts = 0;
      return work({
        select: () => {
          selects += 1;
          if (selects === 1) return { from: () => ({ where: () => ({ for: () => Promise.resolve([{ id: 7, name: "Mower", assignedCrewId: null, archivedAt: null, currentHours: 0, currentMiles: null }]) }) }) };
          if (selects === 2) return { from: () => ({ where: () => ({ limit: () => Promise.resolve([{ role: "company_owner" }]) }) }) };
          if (selects === 3) return { from: () => ({ where: () => ({ for: () => Promise.resolve([{ id: 3, name: "Shop tank", tenantId: 1, isActive: true, availableThousandths: 3000, inventoryValueCents: 1500 }]) }) }) };
          return { from: () => ({ where: () => Promise.resolve([{ total: 10 }]) }) };
        },
        insert: () => ({ values: (value: any) => { inserted.push(value); inserts += 1; return { returning: () => Promise.resolve([{ id: inserts === 1 ? 44 : inserts === 2 ? 45 : 46, ...value }]) }; } }),
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 3, name: "Shop tank", fuelType: "gas", capacityThousandths: null, availableThousandths: 1000, inventoryValueCents: 500, isActive: true, createdAt: new Date() }]) }) }) }),
      });
    });
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send({
      idempotencyKey: "bulk-pretrip", equipmentId: 7, condition: "good",
      fuelGallons: 2, fuelSource: "bulk_tank", bulkFuelTankId: 3,
    });
    expect(response.status).toBe(201);
    expect(response.body.fuelLogId).toBe(44);
    expect(inserted.filter(value => value.type === "dispense")).toHaveLength(1);
    expect(inserted.filter(value => value.fuelSource === "bulk_tank")).toHaveLength(1);
    expect(inserted.filter(value => value.assignedToRole || value.status === "open")).toHaveLength(0);
    expect(response.body.taskId).toMatch(/^inspection-/);
  });

  it("rejects fuel cost without gallons before creating any records", async () => {
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app)
      .post("/equipment/pre-trip")
      .set(headers)
      .send({ idempotencyKey: "cost-only", equipmentId: 7, condition: "good", fuelCost: 14.5 });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "fuelCost requires fuelGallons" });
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not commit partial fuel/reading writes when a later task insert fails", async () => {
    // Settings/equipment are loaded before the idempotency lookup so the
    // canonical checklist fingerprint can be compared.
    // The post-failure duplicate lookup also finds none.
    authorizeAsAdmin();
    select
      .mockReturnValueOnce(whereResult([{ preTripChecklist: [], endOfDayChecklist: [] }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([]))
      .mockReturnValue(whereResult([]));
    let committed = false;
    const insertedValues: any[] = [];
    transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => {
      try {
        let selectCount = 0;
        let insertCount = 0;
        await work({
          select: () => {
            selectCount += 1;
            return selectCount === 1
              ? { from: () => ({ where: () => ({ for: () => Promise.resolve([{ id: 7, name: "Mower", archivedAt: null, currentHours: 0, currentMiles: null }]) }) }) }
              : selectCount === 2
                ? { from: () => ({ where: () => ({ limit: () => Promise.resolve([{ role: "company_owner" }]) }) }) }
                : { from: () => ({ where: () => Promise.resolve([{ total: 2 }]) }) };
          },
          insert: () => ({
            values: (values: unknown) => {
              insertedValues.push(values);
              return {
              returning: () => {
                insertCount += 1;
                return insertCount === 3
                  ? Promise.reject(new Error("forced task insert failure"))
                  : Promise.resolve([{ id: insertCount }]);
              },
              };
            },
          }),
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        });
        committed = true;
      } catch (error) { throw error; }
    });
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send(input);
    expect(response.status).toBe(400);
    expect(committed).toBe(false);
    expect(transaction).toHaveBeenCalledOnce();
    expect(insertedValues[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insertedValues[0].date).not.toContain("T");
  });

  it("requires and snapshots only questions applicable to the equipment type", async () => {
    authorizeAsAdmin();
    select
      .mockReturnValueOnce(whereResult([{
        preTripChecklist: [
          { id: "all", label: "Universal check", required: true },
          { id: "mower", label: "Mower-only check", required: true, equipmentTypes: ["mower"] },
          { id: "truck", label: "Truck-only check", required: true, equipmentTypes: ["truck"] },
        ],
        endOfDayChecklist: [],
      }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([]))
      .mockReturnValue(whereResult([]));

    let taskValues: any;
    transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => {
      let count = 0; return work({
      select: () => { count += 1; return count === 1 ? { from: () => ({ where: () => ({ for: () => Promise.resolve([{ id: 7, name: "Mower", type: "mower", archivedAt: null, currentHours: 0, currentMiles: null }]) }) }) } : { from: () => ({ where: () => ({ limit: () => Promise.resolve([{ role: "company_owner" }]) }) }) }; },
      insert: () => ({
        values: (values: unknown) => {
          taskValues = values;
          return { returning: () => Promise.resolve([{ id: 123 }]) };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }); });

    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send({
      idempotencyKey: "type-specific",
      equipmentId: 7,
      condition: "good",
      checklistResponses: [
        { id: "all", label: "ignored client label", checked: true },
        { id: "mower", label: "ignored client label", checked: true },
        { id: "truck", label: "ignored client label", checked: false },
      ],
    });

    expect(response.status).toBe(201);
    expect(taskValues.preTripChecklistSnapshot).toEqual([
      { id: "all", label: "Universal check", checked: true },
      { id: "mower", label: "Mower-only check", checked: true },
    ]);
  });

  it("does not require a question configured for another equipment type", async () => {
    authorizeAsAdmin();
    select
      .mockReturnValueOnce(whereResult([{
        preTripChecklist: [{ id: "truck", label: "Truck-only check", required: true, equipmentTypes: ["truck"] }],
        endOfDayChecklist: [],
      }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([]))
      .mockReturnValue(whereResult([]));
    transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => {
      let count = 0; return work({
      select: () => { count += 1; return count === 1 ? { from: () => ({ where: () => ({ for: () => Promise.resolve([{ id: 7, name: "Mower", type: "mower", archivedAt: null, currentHours: 0, currentMiles: null }]) }) }) } : { from: () => ({ where: () => ({ limit: () => Promise.resolve([{ role: "company_owner" }]) }) }) }; },
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 124 }]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }); });

    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send({
      idempotencyKey: "other-type-not-required",
      equipmentId: 7,
      condition: "good",
      checklistResponses: [],
    });

    expect(response.status).toBe(201);
  });

  it("requires a matching equipment-type question", async () => {
    authorizeAsAdmin();
    select
      .mockReturnValueOnce(whereResult([{
        preTripChecklist: [{ id: "mower", label: "Mower-only check", required: true, equipmentTypes: ["mower"] }],
        endOfDayChecklist: [],
      }]))
      .mockReturnValueOnce(whereResult([{ type: "mower", archivedAt: null }]))
      .mockReturnValueOnce(whereResult([]));

    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send({
      idempotencyKey: "matching-type-required",
      equipmentId: 7,
      condition: "good",
      checklistResponses: [],
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Complete all required checklist questions" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns 404 before creating an inspection for equipment not assigned to the field user", async () => {
    select
      .mockReturnValueOnce(whereResult([{ id: 7, assignedUserId: 8, assignedCrewId: null }]))
      .mockReturnValueOnce(whereResult([{ role: "technician" }]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send(input);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Equipment not found" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("equipment assignment validation", () => {
  beforeEach(() => { vi.clearAllMocks(); select.mockReset(); transaction.mockReset(); });

  it("rejects an employee assignment from another tenant", async () => {
    // requireOfficeRole recognizes the caller as an office user; the following
    // empty employee lookup models an ID that does not belong to tenant 1.
    select
      .mockReturnValueOnce(whereResult([{ role: "office_manager" }]))
      .mockReturnValueOnce(whereResult([]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment").set(headers).send({
      name: "Mower",
      assignedUserId: 999,
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "assignedUserId must identify an employee in this account" });
  });
});