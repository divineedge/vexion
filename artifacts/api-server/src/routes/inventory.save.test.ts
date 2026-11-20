import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  inventoryCostLotsTable,
  inventoryItemsTable,
  inventoryPartTypesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { installInventoryCostSchema } from "../lib/inventoryCosting";
import inventoryRouter from "./inventory";
import inventoryLocationsRouter from "./inventoryLocations";
import inventoryPartGroupsRouter from "./inventoryPartGroups";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const current = req as typeof req & { user?: { id: number; business_id: number }; verifiedTenantId?: number; verifiedUserId?: number };
  current.user = { id: Number(req.headers["x-user-id"]), business_id: Number(req.headers["x-tenant-id"]) };
  current.verifiedTenantId = current.user.business_id;
  current.verifiedUserId = current.user.id;
  next();
});
app.use(inventoryPartGroupsRouter);
app.use(inventoryRouter);
app.use(inventoryLocationsRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; cause?: { message?: string }; stack?: string };
  res.status(500).json({ error: err.message, cause: err.cause?.message, stack: err.stack });
});

describe("inventory create and update", () => {
  let tenantId = 0;
  let userId = 0;

  beforeAll(async () => {
    await installInventoryCostSchema();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Save repro", defaultMarkupPct: 25 }).returning();
    tenantId = tenant.id;
    const [user] = await db.insert(usersTable).values({
      tenantId,
      name: "Owner",
      email: `owner-${tenantId}@save.invalid`,
      role: "company_owner",
    }).returning();
    userId = user.id;
  });

  afterAll(async () => {
    if (!tenantId) return;
    await db.delete(inventoryCostLotsTable).where(eq(inventoryCostLotsTable.tenantId, tenantId));
    await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));
    await db.delete(inventoryPartTypesTable).where(eq(inventoryPartTypesTable.tenantId, tenantId));
    await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
    // Payroll rates are immutable, so the tenant row can outlive this test.
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId)).catch(() => undefined);
  });

  const authed = () => ({ "x-tenant-id": String(tenantId), "x-user-id": String(userId) });

  it("creates and updates a normal part and a pipe", async () => {
    const type = await request(app).post("/inventory/types").set(authed()).send({ name: "Pipe" });
    expect(type.status, JSON.stringify(type.body)).toBe(201);

    const part = await request(app).post("/inventory").set(authed()).send({
      name: "Brass Gate Valve",
      sku: "BGV-1",
      category: "",
      typeId: null,
      sizeId: null,
      costPrice: 10,
      markupPct: null,
      quantity: 4,
      reorderPoint: 0,
      unit: "each",
      lengthReceived: null,
      pricePerFoot: null,
      availableForBlueprint: false,
      vendorId: null,
      linkedParts: null,
    });
    expect(part.status, JSON.stringify(part.body)).toBe(201);

    const partUpdate = await request(app).patch(`/inventory/${part.body.id}`).set(authed()).send({
      name: "Brass Gate Valve 1in",
      sku: "BGV-1",
      category: "",
      typeId: null,
      sizeId: null,
      costPrice: 12,
      markupPct: null,
      quantity: 4,
      reorderPoint: 0,
      unit: "each",
      lengthReceived: null,
      pricePerFoot: null,
      availableForBlueprint: false,
      vendorId: null,
      linkedParts: null,
    });
    expect(partUpdate.status, JSON.stringify(partUpdate.body)).toBe(200);
    expect(partUpdate.body.reorderPoint).toBe(0);
    expect(partUpdate.body.costPrice).toBe(12);
    expect(partUpdate.body.name).toBe("Brass Gate Valve 1in");

    const pipe = await request(app).post("/inventory").set(authed()).send({
      name: "PVC Pipe",
      sku: "PVC-100",
      category: "",
      typeId: type.body.id,
      sizeId: null,
      costPrice: 8,
      markupPct: null,
      quantity: 100,
      reorderPoint: 0,
      unit: "ft",
      lengthReceived: 100,
      pricePerFoot: 2.5,
      availableForBlueprint: false,
      vendorId: null,
      linkedParts: null,
    });
    expect(pipe.status, JSON.stringify(pipe.body)).toBe(201);
    expect(pipe.body.reorderPoint).toBe(0);
    expect(pipe.body.pricePerFoot).toBe(2.5);
    expect(pipe.body.costPrice).toBe(8);

    const pipeUpdate = await request(app).patch(`/inventory/${pipe.body.id}`).set(authed()).send({
      name: "PVC Pipe",
      sku: "PVC-100",
      category: "",
      typeId: type.body.id,
      sizeId: null,
      costPrice: 8,
      markupPct: 20,
      quantity: 80,
      reorderPoint: 0,
      unit: "ft",
      lengthReceived: 100,
      pricePerFoot: 2.5,
      availableForBlueprint: false,
      vendorId: null,
      linkedParts: null,
    });
    expect(pipeUpdate.status, JSON.stringify(pipeUpdate.body)).toBe(200);
    expect(pipeUpdate.body.reorderPoint).toBe(0);
    expect(pipeUpdate.body.pricePerFoot).toBe(2.5);
    expect(pipeUpdate.body.costPrice).toBe(8);
    expect(pipeUpdate.body.unitPrice).toBe(3);
    expect(pipeUpdate.body.quantity).toBe(80);

    const changed = await request(app).patch(`/inventory/${part.body.id}`).set(authed()).send({
      name: "Brass Gate Valve 1in",
      sku: "BGV-1",
      costPrice: 18,
      markupPct: 30,
      quantity: 7,
      reorderPoint: 0,
      unit: "each",
      pricePerFoot: null,
      linkedParts: null,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.costPrice).toBe(18);
    expect(changed.body.markupPct).toBe(30);
    expect(changed.body.usesDefaultMarkup).toBe(false);
    expect(changed.body.unitPrice).toBe(23.4);
    expect(changed.body.quantity).toBe(7);

    const reread = await request(app).get(`/inventory/${part.body.id}`).set(authed());
    expect(reread.status).toBe(200);
    expect(reread.body.costPrice).toBe(18);
    expect(reread.body.markupPct).toBe(30);
    expect(reread.body.quantity).toBe(7);

    await db.insert(inventoryCostLotsTable).values({
      tenantId,
      inventoryItemId: part.body.id,
      receivedQuantity: 2,
      remainingQuantity: 2,
      unitCost: 40,
      source: "receipt",
    });
    const withLot = await request(app).patch(`/inventory/${part.body.id}`).set(authed()).send({
      costPrice: 17,
      markupPct: 35,
      quantity: 8,
      reorderPoint: 0,
    });
    expect(withLot.status, JSON.stringify(withLot.body)).toBe(200);
    expect(withLot.body.costPrice).toBe(17);
    expect(withLot.body.markupPct).toBe(35);
    expect(withLot.body.quantity).toBe(8);
    const [stored] = await db.select({
      unitPrice: inventoryItemsTable.unitPrice,
      quantity: inventoryItemsTable.quantity,
    }).from(inventoryItemsTable).where(eq(inventoryItemsTable.id, part.body.id));
    expect(stored.unitPrice).toBe(17);
    expect(stored.quantity).toBe(8);
  });

  it("keeps an explicit markup of 0 instead of the company standard", async () => {
    const created = await request(app).post("/inventory").set(authed()).send({
      name: "Zero markup valve",
      sku: "ZERO-1",
      costPrice: 10,
      markupPct: null,
      quantity: 4,
      reorderPoint: 0,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.markupPct).toBe(25);
    expect(created.body.usesDefaultMarkup).toBe(true);

    const zero = await request(app).patch(`/inventory/${created.body.id}`).set(authed()).send({
      costPrice: 21,
      markupPct: 0,
      quantity: 3,
      reorderPoint: 0,
    });
    expect(zero.status, JSON.stringify(zero.body)).toBe(200);
    expect(zero.body.costPrice).toBe(21);
    expect(zero.body.markupPct).toBe(0);
    expect(zero.body.usesDefaultMarkup).toBe(false);
    expect(zero.body.unitPrice).toBe(21);
    expect(zero.body.quantity).toBe(3);

    const again = await request(app).get(`/inventory/${created.body.id}`).set(authed());
    expect(again.body.markupPct).toBe(0);
    expect(again.body.unitPrice).toBe(21);
    expect(again.body.quantity).toBe(3);

    const cleared = await request(app).patch(`/inventory/${created.body.id}`).set(authed()).send({
      costPrice: 21,
      markupPct: null,
      quantity: 3,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.usesDefaultMarkup).toBe(true);
    expect(cleared.body.markupPct).toBe(25);
    expect(cleared.body.unitPrice).toBe(26.25);
  });

  it("updates an item that shares a SKU and still lists locations", async () => {
    const first = await request(app).post("/inventory").set(authed()).send({
      name: "Shared sku",
      sku: "SAME-1",
      costPrice: 4,
      quantity: 1,
      reorderPoint: 0,
    });
    const second = await request(app).post("/inventory").set(authed()).send({
      name: "Shared sku copy",
      sku: "SAME-1",
      costPrice: 4,
      quantity: 1,
      reorderPoint: 0,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const updated = await request(app).patch(`/inventory/${second.body.id}`).set(authed()).send({
      sku: "SAME-1",
      costPrice: 9,
      markupPct: 10,
      quantity: 6,
      reorderPoint: 0,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.costPrice).toBe(9);
    expect(updated.body.markupPct).toBe(10);
    expect(updated.body.quantity).toBe(6);

    const locations = await request(app).get("/inventory/locations").set(authed());
    expect(locations.status, JSON.stringify(locations.body)).toBe(200);
    expect(Array.isArray(locations.body)).toBe(true);
  });
});
