import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const holder = vi.hoisted(() => ({ connection: null as any, savepoint: 0 }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: new Proxy(original.db, {
    get(target, key) {
      if (key === "transaction" && holder.connection) return async (fn: any) => {
        const connection = holder.connection;
        const name = `sandbox_demo_${++holder.savepoint}`;
        await connection.execute(sql.raw(`SAVEPOINT ${name}`));
        try {
          const result = await fn(connection);
          await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
          return result;
        } catch (error) {
          await connection.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
          await connection.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
          throw error;
        }
      };
      const current = holder.connection ?? target;
      const value = current[key];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) };
});

import { db, pool } from "@workspace/db";
import { isSoftwareOwner } from "../lib/softwareBilling";
import { SANDBOX_DEMO_EMAIL, SANDBOX_DEMO_SLUG } from "../lib/sandboxDemo";
import router from "./auth";

describe.skipIf(!(process.env.DATABASE_URL || process.env.PGHOST))("sandbox demo login", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  const app = express();
  app.use(express.json());
  app.use(router);

  beforeAll(async () => {
    client = await connect();
    await client.query("BEGIN");
    holder.connection = drizzle(client);
  });

  afterAll(async () => {
    if (client) {
      try { await client.query("ROLLBACK"); } finally {
        holder.connection = null;
        client.release();
        await pool.end();
      }
    }
  });

  it("opens the shared sandbox without accepting another identity", async () => {
    const first = await request(app).post("/auth/demo").send({ email: "owner@real.example", password: "not-used" });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({
      email: SANDBOX_DEMO_EMAIL,
      role: "technician",
      name: "Demo Field Tech",
    });
    expect(first.body.sessionToken).toEqual(expect.any(String));

    const second = await request(app).post("/auth/demo").send({});
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.tenantId).toBe(first.body.user.tenantId);
    expect(second.body.sessionToken).not.toBe(first.body.sessionToken);

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${first.body.sessionToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: first.body.user.id, tenantId: first.body.user.tenantId, email: SANDBOX_DEMO_EMAIL });

    const passwordLogin = await request(app).post("/auth/login").send({ email: SANDBOX_DEMO_EMAIL, password: "demo" });
    expect(passwordLogin.status).toBe(401);

    const jobs = await db.execute(sql`
      SELECT j.title, t.slug
      FROM jobs j
      INNER JOIN tenants t ON t.id = j.tenant_id
      WHERE j.assignee_id = ${first.body.user.id} AND j.status = 'scheduled'
    `);
    expect(jobs.rows.some(row => row.slug === SANDBOX_DEMO_SLUG && row.title === "Sandbox lawn visit")).toBe(true);

    vi.stubEnv("PLATFORM_OWNER_USER_ID", String(first.body.user.id));
    vi.stubEnv("PLATFORM_OWNER_TENANT_ID", String(first.body.user.tenantId));
    expect(await isSoftwareOwner(first.body.user.id, first.body.user.tenantId)).toBe(false);
    vi.unstubAllEnvs();
  });
});
