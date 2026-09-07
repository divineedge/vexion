import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const select = vi.fn();
const canAccessEquipment = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
  taskBundlesTable: {}, taskBundlesItemsTable: {}, taskBundleCompletionsTable: {},
  equipmentTable: {}, equipmentFuelLogsTable: {}, equipmentReadingLogsTable: {}, equipmentMaintenanceTable: {},
  inventoryItemsTable: {}, shrinkageReportsTable: {}, internalTasksTable: {}, taskNotificationsTable: {},
  usersTable: {}, tenantsTable: {},
}));
vi.mock("../lib/equipmentAccess", () => ({ canAccessEquipment }));
vi.mock("../lib/tenantHelper", () => ({
  getTenantId: () => 1,
  getUserId: () => 2,
}));

const direct = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const ordered = (rows: unknown[]) => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) });

describe("task bundle equipment visibility", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 404 instead of revealing a bundle linked to equipment reassigned away", async () => {
    select
      .mockReturnValueOnce(direct([{ id: 1, name: "Morning checks", createdAt: new Date(), updatedAt: new Date() }]))
      .mockReturnValueOnce(ordered([{ id: 2, linkedEquipmentId: 7 }]))
      .mockReturnValueOnce(direct([{ role: "technician" }]));
    canAccessEquipment.mockResolvedValue(false);
    const app = express(); app.use(express.json());
    const { default: router } = await import("./taskBundles"); app.use("/", router);

    const response = await request(app).get("/task-bundles/1").set("x-tenant-id", "1").set("x-user-id", "2");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Task bundle not found" });
  });
});