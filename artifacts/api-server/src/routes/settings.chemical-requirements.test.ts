import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
  update: vi.fn(),
  isAdminRole: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    execute: mocks.execute,
    update: mocks.update,
  },
  tenantsTable: {
    id: "tenants.id",
  },
  usersTable: {},
}));

vi.mock("../lib/roles", () => ({ isAdminRole: mocks.isAdminRole }));
vi.mock("../lib/emailProvider", () => ({ sendEmail: vi.fn() }));
vi.mock("../lib/gmailProvider", () => ({
  buildGoogleAuthorizeUrl: vi.fn(),
  exchangeGoogleCode: vi.fn(),
}));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));

function tenantRow(chemicalRecordRequirements: Record<string, boolean> = {}) {
  return {
    id: 1,
    name: "Test Tenant",
    timezone: "UTC",
    chemicalRecordRequirements,
  };
}

function selectOnce(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  mocks.select.mockReturnValueOnce({ from });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

async function buildSettingsApp() {
  const app = buildApp();
  const { default: settingsRouter } = await import("./settings");
  app.use(settingsRouter);
  return app;
}

describe("PATCH /settings chemical record requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["owner", 20],
    ["office", 22],
  ])("allows the %s role to save every requirement", async (_role, userId) => {
    mocks.isAdminRole.mockImplementation(async (_tenantId: number, callerId: number) => callerId === userId);
    mocks.execute.mockResolvedValue({ rows: [] });
    const requirements = {
      treatedArea: true,
      treatedZoneName: true,
      targetPest: true,
      applicationMethod: true,
      windSpeed: true,
      windDirection: true,
      temperature: true,
      applicatorName: true,
      applicatorLicenseNumber: true,
      notes: true,
    };
    selectOnce([tenantRow(requirements)]);

    const response = await request(await buildSettingsApp())
      .patch("/settings")
      .set("x-tenant-id", "1")
      .set("x-user-id", String(userId))
      .send({ chemicalRecordRequirements: requirements });

    expect(response.status).toBe(200);
    expect(response.body.chemicalRecordRequirements).toEqual(requirements);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("blocks a technician before persisting requirements", async () => {
    mocks.isAdminRole.mockResolvedValue(false);

    const response = await request(await buildSettingsApp())
      .patch("/settings")
      .set("x-tenant-id", "1")
      .set("x-user-id", "21")
      .send({ chemicalRecordRequirements: { targetPest: true } });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/owner\/office/i);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects unknown keys and non-boolean values", async () => {
    mocks.isAdminRole.mockResolvedValue(true);
    const app = await buildSettingsApp();

    for (const value of [
      { targetPest: "yes" },
      { targetPest: true, unexpected: false },
      [],
    ]) {
      const response = await request(app)
        .patch("/settings")
        .set("x-tenant-id", "1")
        .set("x-user-id", "20")
        .send({ chemicalRecordRequirements: value });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid chemicalRecordRequirements");
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});