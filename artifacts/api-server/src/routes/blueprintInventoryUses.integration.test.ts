import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

const holder = vi.hoisted(() => ({ connection: null as any, savepoint: 0 }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: new Proxy(original.db, {
      get(target, key) {
        if (key === "transaction" && holder.connection) return async (fn: any) => {
          const name = `measured_use_${++holder.savepoint}`;
          const connection = holder.connection;
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
    }),
  };
});

import { db, pool, tenantsTable, blueprintsTable, inventoryItemsTable, inventoryPartTypesTable, inventoryPartSizesTable } from "@workspace/db";
import router from "./blueprintInventoryUses";

describe.skipIf(!(process.env.DATABASE_URL || process.env.PGHOST))("blueprint measured inventory use", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  let tenant: number;
  let blueprint: number;
  let sod: number;
  let pipe: number;
  let muted: number;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { verifiedTenantId: tenant });
    next();
  });
  app.use(router);

  beforeAll(async () => {
    await pool.query(`ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_inputs jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS chosen_plan_version_id integer`);
    await pool.query(`ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_locked boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_locked_reason text`);
    await pool.query(`ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS length_amount double precision`);
    await pool.query(`ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS length_unit text`);
    await pool.query(`CREATE TABLE IF NOT EXISTS blueprint_inventory_uses (
      id serial PRIMARY KEY,
      tenant_id integer NOT NULL REFERENCES tenants(id),
      blueprint_id integer NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
      inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
      amount double precision NOT NULL,
      unit text NOT NULL,
      deducted_quantity double precision NOT NULL,
      deducted_unit text NOT NULL,
      element_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    client = await pool.connect();
    await client.query("BEGIN");
    holder.connection = drizzle(client);
    tenant = (await db.insert(tenantsTable).values({ name: "Measured use rollback" }).returning())[0].id;
    blueprint = (await db.insert(blueprintsTable).values({ tenantId: tenant, name: "Front yard", mode: "landscape" }).returning())[0].id;
    sod = (await db.insert(inventoryItemsTable).values({
      tenantId: tenant, name: "Sod", sku: "SOD-SQFT", quantity: 1000, unit: "sq ft", availableForBlueprint: true, stockAlerts: true,
    }).returning())[0].id;
    const typeId = (await db.insert(inventoryPartTypesTable).values({ tenantId: tenant, name: "Pipe" }).returning())[0].id;
    const sizeId = (await db.insert(inventoryPartSizesTable).values({
      tenantId: tenant, typeId, name: "10 ft stick", lengthAmount: 10, lengthUnit: "ft",
    }).returning())[0].id;
    pipe = (await db.insert(inventoryItemsTable).values({
      tenantId: tenant, name: "PVC", sku: "PVC-FT", quantity: 100, unit: "each", typeId, sizeId, availableForBlueprint: true,
    }).returning())[0].id;
    muted = (await db.insert(inventoryItemsTable).values({
      tenantId: tenant, name: "Quiet gallons", sku: "GAL-MUTE", quantity: 1, unit: "gal", reorderPoint: 5, stockAlerts: false,
    }).returning())[0].id;
  });

  afterAll(async () => {
    holder.connection = null;
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  async function quantityOf(id: number) {
    const [row] = await db.select({ quantity: inventoryItemsTable.quantity, isLowStock: inventoryItemsTable.isLowStock })
      .from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
    return row;
  }

  it("uses 250 sq ft of 1,000 sq ft and leaves 750 sq ft", async () => {
    const created = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: sod, amount: 250, unit: "sq ft" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.remainingLabel).toBe("750 sq ft");
    expect(created.body.onHand).toBe(750);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 750 });

    const edited = await request(app).patch(`/blueprints/${blueprint}/inventory-uses/${created.body.id}`).send({ inventoryItemId: sod, amount: 100, unit: "sq ft" });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.remainingLabel).toBe("900 sq ft");
    expect(await quantityOf(sod)).toMatchObject({ quantity: 900 });

    const removed = await request(app).delete(`/blueprints/${blueprint}/inventory-uses/${created.body.id}`);
    expect(removed.status).toBe(204);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 1000 });
  });

  it("uses 25 feet of a size stored in feet and leaves the remaining feet", async () => {
    const created = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: pipe, amount: 25, unit: "feet" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.remainingLabel).toBe("75 feet");
    expect(created.body.onHand).toBe(75);
    expect(await quantityOf(pipe)).toMatchObject({ quantity: 75 });
    const removed = await request(app).delete(`/blueprints/${blueprint}/inventory-uses/${created.body.id}`);
    expect(removed.status).toBe(204);
    expect(await quantityOf(pipe)).toMatchObject({ quantity: 100 });
  });

  it("converts 16 ounces of a gallon and does not subtract 16 gallons", async () => {
    const created = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: muted, amount: 16, unit: "oz" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.onHand).toBe(0.875);
    expect(created.body.remainingLabel).toBe("0.875 gallons");
    expect(await quantityOf(muted)).toMatchObject({ quantity: 0.875, isLowStock: false });
    await request(app).delete(`/blueprints/${blueprint}/inventory-uses/${created.body.id}`);
  });

  it("does not invent stock or convert length into square feet", async () => {
    const short = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: sod, amount: 1001, unit: "sq ft" });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/Not enough/i);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 1000 });

    const crossed = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: sod, amount: 25, unit: "feet" });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error).toMatch(/Length cannot be converted to square feet/i);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 1000 });

    const again = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: sod, amount: 250, unit: "sq ft" });
    expect(again.status).toBe(201);
    const duplicate = await request(app).post(`/blueprints/${blueprint}/inventory-uses`).send({ inventoryItemId: sod, amount: 250, unit: "sq ft" });
    expect(duplicate.status).toBe(201);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 500 });
    await request(app).delete(`/blueprints/${blueprint}/inventory-uses/${again.body.id}`);
    await request(app).delete(`/blueprints/${blueprint}/inventory-uses/${duplicate.body.id}`);
    expect(await quantityOf(sod)).toMatchObject({ quantity: 1000 });
  });
});
