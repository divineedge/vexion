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
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
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
  });
});
