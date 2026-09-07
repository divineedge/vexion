import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const select = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const canAccessEquipment = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select, insert, update, delete: vi.fn() },
  internalTasksTable: {}, taskNotificationsTable: {}, usersTable: {},
  customersTable: {}, jobsTable: {}, propertiesTable: {}, equipmentTable: {},
}));
vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => 1, getUserId: () => 2 }));
vi.mock("../lib/roles", () => ({
  ADMIN_ROLES: new Set(["company_owner", "office_manager", "department_manager"]),
  getCallerRole: vi.fn().mockResolvedValue("technician"),
  getSingleAdmin: vi.fn(),
}));
vi.mock("../lib/taskRouting", () => ({
  validateTaskAssignment: vi.fn().mockResolvedValue({ ok: true }),
  roleBucketMatches: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/equipmentAccess", () => ({ canAccessEquipment }));

const direct = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });

describe("task equipment-context write visibility", () => {
  beforeEach(() => { vi.clearAllMocks(); canAccessEquipment.mockResolvedValue(false); });

  it("returns 404 without inserting an inaccessible equipment-context task", async () => {
    const app = express(); app.use(express.json());
    const { default: router } = await import("./internalTasks"); app.use("/", router);
    const response = await request(app).post("/tasks").send({
      title: "Inspect asset",
      assignedToUserId: 2,
      contextType: "equipment",
      contextId: 7,
    });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Equipment not found" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns 404 without retargeting a creator task to inaccessible equipment", async () => {
    select.mockReturnValueOnce(direct([{
      id: 4, createdById: 2, assignedToUserId: 2, assignedToRole: null,
      contextType: "job", contextId: 8, status: "open",
    }]));
    const app = express(); app.use(express.json());
    const { default: router } = await import("./internalTasks"); app.use("/", router);
    const response = await request(app).patch("/tasks/4").send({
      contextType: "equipment",
      contextId: 7,
    });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Equipment not found" });
    expect(update).not.toHaveBeenCalled();
    expect(response.text).not.toContain("equipment");
  });
});