import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { db, tenantsTable, usersTable, staffSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import propertiesRouter from "./properties";
import { createHash } from "crypto";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("local address suggestions", () => {
  const app = express();
  app.use(express.json());
  app.use("/api", propertiesRouter);

  let tenantId: number;
  let staffToken: string;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

  beforeAll(async () => {
    const [tenant] = await db.insert(tenantsTable).values({
      name: "__test_local_address_suggestions__",
      businessAddress: "100 Main St",
      businessCity: "Denver",
      businessState: "CO",
      businessZip: "80202",
      businessLat: 39.7527,
      businessLng: -104.9992,
    }).returning({ id: tenantsTable.id });
    tenantId = tenant.id;
    const [user] = await db.insert(usersTable).values({
      tenantId,
      email: `address-test-${tenantId}@example.test`,
      name: "Address Test Owner",
      role: "company_owner",
      passwordHash: "mock",
    }).returning({ id: usersTable.id });
    staffToken = `address-test-token-${tenantId}`;
    await db.insert(staffSessionsTable).values({
      tenantId,
      userId: user.id,
      tokenHash: createHash("sha256").update(staffToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    process.env.VITE_GOOGLE_MAPS_API_KEY = "test-key";
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    else process.env.VITE_GOOGLE_MAPS_API_KEY = originalKey;
    await db.delete(staffSessionsTable).where(eq(staffSessionsTable.tenantId, tenantId));
    await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  it("uses valid Google local bias and structured place details", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/place/autocomplete/")) {
        return new Response(JSON.stringify({
          status: "OK",
          predictions: [{ description: "1234 Test Way, Denver, CO, USA", place_id: "place-1" }],
        }));
      }
      if (url.includes("/place/details/")) {
        return new Response(JSON.stringify({
          status: "OK",
          result: {
            formatted_address: "1234 Test Way, Denver, CO 80202, USA",
            address_components: [
              { long_name: "1234", short_name: "1234", types: ["street_number"] },
              { long_name: "Test Way", short_name: "Test Way", types: ["route"] },
              { long_name: "Denver", short_name: "Denver", types: ["locality"] },
              { long_name: "Colorado", short_name: "CO", types: ["administrative_area_level_1"] },
              { long_name: "80202", short_name: "80202", types: ["postal_code"] },
            ],
            geometry: { location: { lat: 39.75, lng: -104.99 } },
          },
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const response = await request(app)
      .get("/api/address-suggestions?q=1234%20Test")
      .set("x-staff-session", staffToken)
      .set("x-tenant-id", "1");

    expect(response.status).toBe(200);
    expect(response.body.radiusApplied).toBe(true);
    expect(response.body.center).toEqual({ lat: 39.7527, lng: -104.9992 });
    expect(response.body.items[0]).toMatchObject({
      address: "1234 Test Way",
      city: "Denver",
      state: "CO",
      zip: "80202",
      source: "google",
    });
    expect(requestedUrls[0]).toContain("radius=50000");
    expect(requestedUrls[0]).not.toContain("strictbounds");
    expect(requestedUrls.some(url => url.includes("photon.komoot.io"))).toBe(false);
    expect(requestedUrls.some(url => url.includes("nominatim.openstreetmap.org"))).toBe(false);
  });

  it("does not expose an arbitrary tenant center without a verified staff session", async () => {
    vi.mocked(globalThis.fetch).mockClear();
    const response = await request(app)
      .get("/api/address-suggestions?q=1234%20Test")
      .set("x-tenant-id", String(tenantId));

    expect(response.status).toBe(401);
    expect(response.body.center).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});