import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const select = vi.fn();
const canAccessEquipment = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  internalTasksTable: {}, taskNotificationsTable: {}, usersTable: {},
  customersTable: {}, jobsTable: {}, propertiesTable: {}, equipmentTable: {},
}));
vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => 1, getUserId: () => 2 }));
vi.mock("../lib/equipmentAccess", () => ({ canAccessEquipment }));

const direct = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const ordered = (rows: unknown[]) => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) });

describe("equipment-context task visibility", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("removes equipment tasks from a field user's history after reassignment", async () => {
    select
      .mockReturnValueOnce(direct([{ role: "technician" }]))
      .mockReturnValueOnce(ordered([{
        id: 4, contextType: "equipment", contextId: 7, createdById: 2,
        assignedToUserId: 2, assignedToRole: null, archivedAt: null,
      }]));
    canAccessEquipment.mockResolvedValue(false);
    const app = express(); app.use(express.json());
    const { default: router } = await import("./internalTasks"); app.use("/", router);

    const response = await request(app).get("/tasks?contextType=equipment");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(canAccessEquipment).toHaveBeenCalledWith(1, 2, 7);
  });

  it("returns 404 for an equipment-context task detail after reassignment", async () => {
    select
      .mockReturnValueOnce(direct([{ role: "technician" }]))
      .mockReturnValueOnce(direct([{
        id: 4, contextType: "equipment", contextId: 7, createdById: 2,
        assignedToUserId: 2, assignedToRole: null,
      }]));
    canAccessEquipment.mockResolvedValue(false);
    const app = express(); app.use(express.json());
    const { default: router } = await import("./internalTasks"); app.use("/", router);

    const response = await request(app).get("/tasks/4");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Task not found" });
  });
});