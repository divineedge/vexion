import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";

const holder = vi.hoisted(() => ({ connection: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, { get(target, key) {
    const current = holder.connection ?? target, value = current[key];
    return typeof value === "function" ? value.bind(current) : value;
  } }) };
});
vi.mock("../lib/scheduleWeather", () => ({ loadScheduleForecast: vi.fn() }));
import { db, pool, tenantsTable, usersTable, staffSessionsTable, customersTable, propertiesTable } from "@workspace/db";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { loadScheduleForecast } from "../lib/scheduleWeather";
import router from "./scheduleWeather";

describe("Scheduling forecast staff/tenant boundary (rollback-only PostgreSQL)", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  let tenant: number, property: number, unpinned: number, foreignProperty: number;
  const roles = ["company_owner", "office_manager", "department_manager", "crew_manager", "technician", "employee"];
  const tokens: Record<string, string> = {};
  const app = express(); app.use(requireVerifiedStaff); app.use(router);
  const call = (role = "company_owner", propertyId: number | string = property) =>
    request(app).get("/schedule/weather").query({ propertyId }).set("Authorization", `Bearer ${tokens[role]}`);
  beforeAll(async () => {
    client = await connect(); await client.query("BEGIN"); holder.connection = drizzle(client);
    tenant = (await db.insert(tenantsTable).values({ name: "Rollback weather company", timezone: "America/Denver" }).returning())[0].id;
    const foreignTenant = (await db.insert(tenantsTable).values({ name: "Rollback other weather company" }).returning())[0].id;
    for (const role of roles) {
      const user = (await db.insert(usersTable).values({ tenantId: tenant, name: "Weather fixture", role, email: `${role}-${tenant}@weather.invalid` }).returning())[0];
      const token = `rollback-weather-${tenant}-${role}`; tokens[role] = token;
      await db.insert(staffSessionsTable).values({
        tenantId: tenant, userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    const customer = (await db.insert(customersTable).values({ tenantId: tenant, name: "Weather fixture", email: "", phone: "" }).returning())[0];
    const otherCustomer = (await db.insert(customersTable).values({ tenantId: foreignTenant, name: "Weather fixture", email: "", phone: "" }).returning())[0];
    property = (await db.insert(propertiesTable).values({ tenantId: tenant, customerId: customer.id, address: "Saved pin fixture", lat: 40, lng: -105 }).returning())[0].id;
    unpinned = (await db.insert(propertiesTable).values({ tenantId: tenant, customerId: customer.id, address: "No pin fixture" }).returning())[0].id;
    foreignProperty = (await db.insert(propertiesTable).values({ tenantId: foreignTenant, customerId: otherCustomer.id, address: "Private fixture", lat: 30, lng: -80 }).returning())[0].id;
  });
  beforeEach(() => {
    vi.mocked(loadScheduleForecast).mockReset();
    vi.mocked(loadScheduleForecast).mockImplementation(async loc => ({
      propertyId: loc.propertyId, location: loc.address, latitude: loc.lat, longitude: loc.lng,
      timezone: loc.timezone, fetchedAt: new Date().toISOString(), source: "Open-Meteo", daily: [], hourly: [],
    }));
  });
  afterAll(async () => {
    if (client) { try { await client.query("ROLLBACK"); } finally { holder.connection = null; client.release(); await pool.end(); } }
  });
  it("rejects unauthenticated requests and forged caller identity headers", async () => {
    expect((await request(app).get("/schedule/weather").query({ propertyId: property }).set("x-tenant-id", String(tenant)).set("x-user-id", "1")).status).toBe(401);
    expect(loadScheduleForecast).not.toHaveBeenCalled();
  });
  it.each(roles.slice(0, 4))("allows %s and uses trusted property pin/company timezone", async role => {
    const res = await call(role);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(loadScheduleForecast).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenant, propertyId: property, lat: 40, lng: -105, timezone: "America/Denver" }));
  });
  it.each(["technician", "employee"])("forbids direct API access for %s", async role => {
    expect((await call(role)).status).toBe(403);
    expect(loadScheduleForecast).not.toHaveBeenCalled();
  });
  it("never fetches another company's coordinates", async () => {
    expect((await call("company_owner", foreignProperty)).status).toBe(404);
    expect(loadScheduleForecast).not.toHaveBeenCalled();
  });
  it.each(["invalid", "0", "-1", "1.5"])("rejects invalid property ids: %s", async input => {
    expect((await call("company_owner", input)).status).toBe(400);
    expect(loadScheduleForecast).not.toHaveBeenCalled();
  });
  it("requires the actual map pin rather than silently geocoding a different location", async () => {
    expect((await call("company_owner", unpinned)).status).toBe(422);
    expect(loadScheduleForecast).not.toHaveBeenCalled();
  });
  it("reports provider failure without fabricating clear weather", async () => {
    vi.mocked(loadScheduleForecast).mockRejectedValueOnce(new Error("provider offline"));
    const res = await call();
    expect(res.status).toBe(503); expect(res.body.error).toContain("unavailable");
    expect(res.body.daily).toBeUndefined();
  });
});
