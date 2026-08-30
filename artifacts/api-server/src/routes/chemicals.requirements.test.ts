import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const table = (name: string) => new Proxy({ _table: name }, {
  get(target, property) {
    return property in target ? target[property as keyof typeof target] : `${name}.${String(property)}`;
  },
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
  },
  chemicalProductsTable: table("chemical_products"),
  chemicalMixturesTable: table("chemical_mixtures"),
  chemicalMixtureItemsTable: table("chemical_mixture_items"),
  chemicalApplicationsTable: table("chemical_applications"),
  jobsTable: table("jobs"),
  propertiesTable: table("properties"),
  tenantsTable: table("tenants"),
  usersTable: table("users"),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

async function buildChemicalsApp() {
  const app = buildApp();
  const { default: chemicalsRouter } = await import("./chemicals");
  app.use(chemicalsRouter);
  return app;
}

function makeTerminal(result: unknown[]) {
  const promise = Promise.resolve(result) as Promise<unknown[]> & {
    where: (...args: unknown[]) => ReturnType<typeof makeTerminal>;
    orderBy: (...args: unknown[]) => Promise<unknown[]>;
  };
  promise.where = vi.fn(() => makeTerminal(result));
  promise.orderBy = vi.fn().mockResolvedValue(result);
  return promise;
}

function queueSelects(...results: unknown[][]) {
  let index = 0;
  mocks.select.mockImplementation(() => {
    const result = results[index++] ?? [];
    const chain = {
      where: vi.fn(() => makeTerminal(result)),
      orderBy: vi.fn().mockResolvedValue(result),
      leftJoin: vi.fn(),
    };
    chain.leftJoin.mockReturnValue(chain);
    return { from: vi.fn().mockReturnValue(chain) };
  });
}

const baseApplication = {
  productId: 12,
  volumeApplied: 2.5,
  volumeUnit: "gal",
  appliedAt: "2026-08-30T18:30:00.000Z",
};

const jobRow = {
  job: { id: 7, tenantId: 1, propertyId: 4 },
  size: 5000,
  sizeUnit: "sqft",
};

describe("POST /jobs/:id/chemical-applications validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["zero volume", { volumeApplied: 0 }, "volumeApplied"],
    ["negative volume", { volumeApplied: -1 }, "volumeApplied"],
    ["non-numeric volume", { volumeApplied: "many" }, "volumeApplied"],
    ["missing product and mixture", { productId: undefined }, "productOrMixture"],
    ["both product and mixture", { mixtureId: 3 }, "productOrMixture"],
    ["zero product ID", { productId: 0 }, "productOrMixture"],
    ["decimal product ID", { productId: "1.5" }, "productOrMixture"],
    ["text product ID", { productId: "abc" }, "productOrMixture"],
    ["blank volume unit", { volumeUnit: " " }, "volumeUnit"],
    ["timestamp without timezone", { appliedAt: "2026-08-30T18:30" }, "appliedAt"],
    ["impossible timestamp", { appliedAt: "2026-02-29T18:30:00Z" }, "appliedAt"],
  ])("rejects %s", async (_label, override, expectedField) => {
    queueSelects([jobRow]);
    const response = await request(await buildChemicalsApp())
      .post("/jobs/7/chemical-applications")
      .set("x-tenant-id", "1")
      .set("x-user-id", "20")
      .send({ ...baseApplication, ...override });

    expect(response.status).toBe(400);
    expect(response.body.fields).toHaveProperty(expectedField);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only optional text and malformed optional numerics", async () => {
    queueSelects([jobRow]);
    const response = await request(await buildChemicalsApp())
      .post("/jobs/7/chemical-applications")
      .set("x-tenant-id", "1")
      .set("x-user-id", "20")
      .send({
        ...baseApplication,
        treatedArea: " ",
        areaUnit: " ",
        treatedZoneName: " ",
        targetPest: " ",
        applicationMethod: " ",
        windSpeed: "-0.1",
        windDirection: " ",
        temperature: "not-a-number",
        applicatorName: " ",
        applicatorLicenseNumber: " ",
        notes: " ",
      });

    expect(response.status).toBe(400);
    expect(response.body.fields).toEqual({
      treatedArea: "Treated area must be a positive number",
      windSpeed: "Wind speed must be zero or greater",
      temperature: "Temperature must be a valid number",
      areaUnit: "Area unit cannot be blank",
      treatedZoneName: "Treated zone or location cannot be blank",
      targetPest: "Target pest or weed cannot be blank",
      applicationMethod: "Application method cannot be blank",
      windDirection: "Wind direction cannot be blank",
      applicatorName: "Applicator name cannot be blank",
      applicatorLicenseNumber: "Applicator license number cannot be blank",
      notes: "Notes cannot be blank",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("enforces every tenant-configured field on direct API requests", async () => {
    const allRequired = {
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
    queueSelects(
      [jobRow],
      [],
      [{ chemicalRecordRequirements: allRequired }],
    );

    const response = await request(await buildChemicalsApp())
      .post("/jobs/7/chemical-applications")
      .set("x-tenant-id", "1")
      .set("x-user-id", "20")
      .send(baseApplication);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Complete all required chemical record fields");
    expect(response.body.fields).toEqual({
      treatedArea: "Treated area must be a positive number",
      areaUnit: "Area unit is required when treated area is required",
      treatedZoneName: "Treated zone or location is required",
      targetPest: "Target pest or weed is required",
      applicationMethod: "Application method is required",
      windSpeed: "Wind speed must be zero or greater",
      windDirection: "Wind direction is required",
      temperature: "Temperature must be a valid number",
      applicatorName: "Applicator name is required",
      applicatorLicenseNumber: "Applicator license number is required",
      notes: "Notes are required",
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("historical chemical applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps old records readable after requirements become stricter", async () => {
    const oldRecord = {
      id: 91,
      tenantId: 1,
      jobId: 7,
      productName: "Legacy Herbicide",
      mixtureName: null,
      volumeApplied: 1,
      volumeUnit: "gal",
      treatedArea: null,
      areaUnit: null,
      treatedZoneName: null,
      targetPest: null,
      applicationMethod: null,
      windSpeed: null,
      windDirection: null,
      temperature: null,
      applicatorName: null,
      applicatorLicenseNumber: null,
      notes: null,
      appliedAt: new Date("2025-01-15T12:00:00.000Z"),
      createdAt: new Date("2025-01-15T12:00:00.000Z"),
      updatedAt: new Date("2025-01-15T12:00:00.000Z"),
      breakdown: null,
    };
    queueSelects([{ id: 7, tenantId: 1 }], [oldRecord]);

    const response = await request(await buildChemicalsApp())
      .get("/jobs/7/chemical-applications")
      .set("x-tenant-id", "1")
      .set("x-user-id", "20");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      ...oldRecord,
      appliedAt: "2025-01-15T12:00:00.000Z",
      createdAt: "2025-01-15T12:00:00.000Z",
      updatedAt: "2025-01-15T12:00:00.000Z",
      breakdown: [],
    }]);
  });
});