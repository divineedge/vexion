import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  blueprintsTable,
  db,
  jobsTable,
  pool,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { installCustomerMergeSchema } from "../lib/customerMerge";
import customersRouter from "./customers";

const RUN = !!process.env.DATABASE_URL;

describe.sequential.skipIf(!RUN)("customer open, hide, and merge", () => {
  let tenantId = 0;
  let userId = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { id: number; business_id: number } }).user = { id: userId, business_id: tenantId };
    next();
  });
  app.use("/api", customersRouter);

  beforeAll(async () => {
    await installCustomerMergeSchema();
    const [tenant] = await db.insert(tenantsTable).values({ name: "__test_customer_hide_merge__" }).returning({ id: tenantsTable.id });
    tenantId = tenant.id;
    const [user] = await db.insert(usersTable).values({
      tenantId,
      name: "Hide Test Owner",
      email: `hide-owner-${randomUUID()}@example.test`,
      passwordHash: "mock",
      role: "company_owner",
    }).returning({ id: usersTable.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (!tenantId) return;
    const client = await pool.connect();
    try {
      const tables = await client.query<{ relname: string }>(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
      `);
      await client.query("BEGIN");
      await client.query("SAVEPOINT rolecheck");
      let replica = false;
      try {
        await client.query("SET LOCAL session_replication_role = replica");
        replica = true;
        await client.query("RELEASE SAVEPOINT rolecheck");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT rolecheck");
      }
      if (replica) {
        for (const table of tables.rows) {
          await client.query(`DELETE FROM ${client.escapeIdentifier(table.relname)} WHERE tenant_id = $1`, [tenantId]);
        }
        await client.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
      } else {
        await client.query("DELETE FROM blueprints WHERE tenant_id = $1", [tenantId]);
        await client.query("DELETE FROM job_report_baselines WHERE job_id IN (SELECT id FROM jobs WHERE tenant_id = $1)", [tenantId]);
        await client.query("DELETE FROM jobs WHERE tenant_id = $1", [tenantId]);
        await client.query("DELETE FROM customer_merge_records WHERE tenant_id = $1", [tenantId]);
        await client.query("DELETE FROM activity_log WHERE tenant_id = $1", [tenantId]);
        await client.query("DELETE FROM customers WHERE tenant_id = $1", [tenantId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  async function createCustomer(name: string) {
    const response = await request(app).post("/api/customers").send({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID()}@example.test`,
      phone: `555${randomUUID().replace(/\D/g, "").slice(0, 7).padEnd(7, "4")}`,
    });
    expect(response.status).toBe(201);
    return response.body as { id: number; name: string };
  }

  it("returns the saved customer from the detail route and the default list", async () => {
    const customer = await createCustomer("Open Me");
    const response = await request(app).get(`/api/customers/${customer.id}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(customer.id);
    expect(response.body.name).toBe("Open Me");
    const listed = await request(app).get("/api/customers").query({ activeOnly: "true", q: "Open Me" });
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item: { id: number }) => item.id)).toContain(customer.id);
  });

  it("still lists customers when hidden_at has not been added", async () => {
    const customer = await createCustomer("Still Listed");
    await pool.query("ALTER TABLE customers RENAME COLUMN hidden_at TO hidden_at_absent");
    try {
      const response = await request(app).get("/api/customers").query({ activeOnly: "true", q: "Still Listed" });
      expect(response.status).toBe(200);
      expect(response.body.items.map((item: { id: number }) => item.id)).toContain(customer.id);
      const hiddenView = await request(app).get("/api/customers").query({ hiddenOnly: "true", includeHidden: "true", q: "Still Listed" });
      expect(hiddenView.status).toBe(200);
      expect(hiddenView.body.items.map((item: { id: number }) => item.id)).not.toContain(customer.id);
    } finally {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'hidden_at_absent'
          ) THEN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'hidden_at'
            ) THEN
              ALTER TABLE customers DROP COLUMN hidden_at;
            END IF;
            ALTER TABLE customers RENAME COLUMN hidden_at_absent TO hidden_at;
          END IF;
        END $$;
      `);
    }
  });

  it("deletes a customer with no history and hides one that has a job", async () => {
    const empty = await createCustomer("No History");
    const deleted = await request(app).delete(`/api/customers/${empty.id}`);
    expect(deleted.status).toBe(204);
    expect((await request(app).get(`/api/customers/${empty.id}`)).status).toBe(404);

    const kept = await createCustomer("Has Work");
    const [job] = await db.insert(jobsTable).values({
      tenantId,
      customerId: kept.id,
      title: "Spring cleanup",
      scheduledAt: new Date("2026-04-01T15:00:00Z"),
    }).returning({ id: jobsTable.id });
    const blocked = await request(app).delete(`/api/customers/${kept.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.canHide).toBe(true);
    expect((await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.id, job.id)))).toHaveLength(1);

    const hidden = await request(app).post(`/api/customers/${kept.id}/hide`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.hiddenAt).toEqual(expect.any(String));
    const active = await request(app).get("/api/customers").query({ activeOnly: "true", q: "Has Work" });
    expect(active.body.items.map((item: { id: number }) => item.id)).not.toContain(kept.id);
    const hiddenList = await request(app).get("/api/customers").query({ hiddenOnly: "true", includeHidden: "true", q: "Has Work" });
    expect(hiddenList.body.items.map((item: { id: number }) => item.id)).toContain(kept.id);
    const opened = await request(app).get(`/api/customers/${kept.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.name).toBe("Has Work");
  });

  it("moves job and blueprint history onto the customer that is kept", async () => {
    const primary = await createCustomer("Kept Customer");
    const source = await createCustomer("Duplicate Customer");
    const [job] = await db.insert(jobsTable).values({
      tenantId,
      customerId: source.id,
      title: "Kept with the primary",
      scheduledAt: new Date("2026-05-01T15:00:00Z"),
    }).returning({ id: jobsTable.id });
    const [blueprint] = await db.insert(blueprintsTable).values({
      tenantId,
      name: "Front yard plan",
      jobId: job.id,
    }).returning({ id: blueprintsTable.id });
    expect((await request(app).post(`/api/customers/${source.id}/hide`)).status).toBe(200);
    const beforeMerge = await request(app).get("/api/customers").query({ includeArchived: "true", includeHidden: "true", q: "Duplicate Customer" });
    expect(beforeMerge.body.items.map((item: { id: number }) => item.id)).toContain(source.id);
    const defaultList = await request(app).get("/api/customers").query({ activeOnly: "true", q: "Duplicate Customer" });
    expect(defaultList.body.items.map((item: { id: number }) => item.id)).not.toContain(source.id);

    const merged = await request(app).post(`/api/customers/${primary.id}/merge`).send({ sourceId: source.id, confirm: true });
    expect(merged.status).toBe(200);
    const [movedJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, job.id));
    expect(movedJob.customerId).toBe(primary.id);
    expect(movedJob.title).toBe("Kept with the primary");
    const [keptBlueprint] = await db.select().from(blueprintsTable).where(eq(blueprintsTable.id, blueprint.id));
    expect(keptBlueprint.jobId).toBe(job.id);
    expect(keptBlueprint.name).toBe("Front yard plan");
    const sourceRow = await request(app).get(`/api/customers/${source.id}`);
    expect(sourceRow.body.mergedIntoCustomerId).toBe(primary.id);
    expect(sourceRow.body.hiddenAt).toEqual(expect.any(String));
    const primaryRow = await request(app).get(`/api/customers/${primary.id}`);
    expect(primaryRow.status).toBe(200);
    expect(primaryRow.body.name).toBe("Kept Customer");
  });
});
