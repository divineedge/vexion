import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const select = vi.fn();
const remove = vi.fn();
const canAccessEquipment = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select, delete: remove, insert: vi.fn() },
  jobEquipmentUsesTable: {}, jobsTable: {}, usersTable: {},
}));
vi.mock("./auth", () => ({
  resolveStaffSession: vi.fn().mockResolvedValue({ tenantId: 1, userId: 2 }),
}));
vi.mock("../lib/equipmentAccess", () => ({ canAccessEquipment }));

const one = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
const many = (rows: unknown[]) => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) });

describe("job equipment-use visibility", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does not return a use for equipment reassigned away from the caller", async () => {
    select
      .mockReturnValueOnce(one([{ id: 10 }])) // verified active staff account
      .mockReturnValueOnce(one([{ id: 8 }])) // route job
      .mockReturnValueOnce(many([{ id: 44, equipmentId: 7, createdAt: new Date() }]));
    canAccessEquipment.mockResolvedValue(false);
    const app = express(); app.use(express.json());
    const { default: router } = await import("./jobEquipmentUses"); app.use("/", router);

    const response = await request(app).get("/jobs/8/equipment-uses");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(canAccessEquipment).toHaveBeenCalledWith(1, 2, 7);
  });

  it("returns 404 rather than deleting a use for equipment reassigned away", async () => {
    select
      .mockReturnValueOnce(one([{ id: 10 }])) // verified active staff account
      .mockReturnValueOnce(one([{ id: 44, jobId: 8, equipmentId: 7 }]));
    canAccessEquipment.mockResolvedValue(false);
    const app = express(); app.use(express.json());
    const { default: router } = await import("./jobEquipmentUses"); app.use("/", router);

    const response = await request(app).delete("/jobs/8/equipment-uses/44");
    expect(response.status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });
});