import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const transaction = vi.fn();
const select = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select, transaction, update: vi.fn(), insert: vi.fn(), delete: vi.fn() },
  equipmentTable: {}, equipmentMaintenanceTable: {}, equipmentFuelLogsTable: {},
  equipmentReadingLogsTable: {}, equipmentLifecycleEventsTable: {}, tenantEquipmentTypesTable: {},
  tenantsTable: {}, usersTable: {}, jobsTable: {}, taskBundlesItemsTable: {}, inventoryItemsTable: {},
  internalTasksTable: {},
}));
vi.mock("../lib/roles", () => ({ isOwnerRole: vi.fn() }));
vi.mock("../lib/importExport", () => ({
  importUpload: { single: vi.fn().mockReturnValue((_a: unknown, _b: unknown, next: () => void) => next()) },
  handleExportRequest: vi.fn(), handleImportPreview: vi.fn(), handleImportCommit: vi.fn(),
  requireString: vi.fn(), optionalString: vi.fn(), optionalNumber: vi.fn(), optionalBoolean: vi.fn(),
  registerImportExportConfig: vi.fn(),
}));

const input = { idempotencyKey: "retry-key", equipmentId: 7, condition: "good", fuelGallons: 2, readingType: "hours", readingValue: 12 };
const headers = { "x-tenant-id": "1", "x-user-id": "2" };
const whereResult = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });

describe("POST /equipment/pre-trip", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns the prior successful task and performs no duplicate transaction", async () => {
    select.mockReturnValueOnce(whereResult([{ id: 99 }]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./equipment"); app.use("/", router);
    const response = await request(app).post("/equipment/pre-trip").set(headers).send(input);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ taskId: 99, duplicate: true });
    expect(transaction).not.toHaveBeenCalled();
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
    // First lookup finds no completed request; post-failure duplicate lookup also finds none.
    select.mockReturnValue(whereResult([]));
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
});