import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

const fixture = vi.hoisted(() => ({ connection: null as any }));
vi.mock("@workspace/db", async (original) => {
  const module = await original<typeof import("@workspace/db")>();
  return {
    ...module,
    db: new Proxy(module.db, {
      get(target, key) {
        const active = fixture.connection ?? target;
        const value = active[key];
        return typeof value === "function" ? value.bind(active) : value;
      },
    }),
  };
});

import { db, pool, staffSessionsTable, tenantsTable, usersTable } from "@workspace/db";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { defaultForecastView } from "../lib/scheduleForecastView";
import router from "./scheduleWeather";

const RUN = !!process.env.DATABASE_URL;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

describe.skipIf(!RUN)("schedule forecast view", () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { void requireVerifiedStaff(req, res, next); });
  app.use(router);

  let fixtureClient: { query: (text: string) => Promise<unknown>; release: () => void };
  let ownerToken = "";
  let otherToken = "";
  const auth = (token: string) => ({ "x-staff-session": token });

  beforeAll(async () => {
    await pool.query(readFileSync(new URL("../../../../lib/db/drizzle/0118_schedule_forecast_view.sql", import.meta.url), "utf8"));
    fixtureClient = await pool.connect();
    await fixtureClient.query("BEGIN");
    fixture.connection = drizzle(fixtureClient);
    const suffix = randomBytes(4).toString("hex");
    const [tenant] = await db.insert(tenantsTable).values({ name: `Forecast view ${suffix}` }).returning();
    const [owner, other] = await db.insert(usersTable).values([
      { tenantId: tenant.id, name: "Forecast Owner", email: `forecast-owner-${suffix}@example.invalid`, role: "company_owner", passwordHash: "mock" },
      { tenantId: tenant.id, name: "Forecast Other", email: `forecast-other-${suffix}@example.invalid`, role: "office_manager", passwordHash: "mock" },
    ]).returning();
    ownerToken = `forecast-owner-${suffix}`;
    otherToken = `forecast-other-${suffix}`;
    await db.insert(staffSessionsTable).values([
      { tenantId: tenant.id, userId: owner.id, tokenHash: hash(ownerToken), expiresAt: new Date(Date.now() + 3600_000) },
      { tenantId: tenant.id, userId: other.id, tokenHash: hash(otherToken), expiresAt: new Date(Date.now() + 3600_000) },
    ]);
  });

  afterAll(async () => {
    try { await fixtureClient?.query("ROLLBACK"); }
    finally { fixture.connection = null; fixtureClient?.release(); }
  });

  it("saves hours, hourly collapse, and minimized days for one user only", async () => {
    const custom = { startHour: 6, endHour: 18, hourlyMinimized: true, minimizedDays: ["2026-11-26", "2026-11-27"] };
    expect((await request(app).put("/schedule/forecast-view").set(auth(ownerToken)).send(custom)).status).toBe(200);
    const owner = await request(app).get("/schedule/forecast-view").set(auth(ownerToken));
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual(custom);
    const other = await request(app).get("/schedule/forecast-view").set(auth(otherToken));
    expect(other.body).toEqual(defaultForecastView());
    expect((await request(app).put("/schedule/forecast-view").set(auth(ownerToken)).send({
      startHour: 18, endHour: 6, hourlyMinimized: false, minimizedDays: [],
    })).status).toBe(400);
    const still = await request(app).get("/schedule/forecast-view").set(auth(ownerToken));
    expect(still.body).toEqual(custom);
  });
});
