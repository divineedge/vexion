import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, inventoryLocationsTable, inventoryLocationStockTable, inventoryTransfersTable, inventoryItemsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

async function getUserRole(tenantId: number, userId: number): Promise<string | null> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return user?.role ?? null;
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getUserRole(tenantId, userId);
  if (role === "technician") {
    res.status(403).json({ error: "Technicians cannot manage inventory locations" });
    return;
  }
  next();
}

function formatLocation(loc: typeof inventoryLocationsTable.$inferSelect) {
  return {
    id: loc.id,
    tenantId: loc.tenantId,
    name: loc.name,
    description: loc.description ?? null,
    type: loc.type,
    isActive: loc.isActive,
    createdAt: loc.createdAt.toISOString(),
    updatedAt: loc.updatedAt.toISOString(),
  };
}

function formatStockEntry(
  stock: typeof inventoryLocationStockTable.$inferSelect,
  extras: { itemName?: string; itemSku?: string; locationName?: string; unitPrice?: number; unit?: string }
) {
  return {
    id: stock.id,
    tenantId: stock.tenantId,
    inventoryItemId: stock.inventoryItemId,
    itemName: extras.itemName ?? "",
    itemSku: extras.itemSku ?? "",
    locationId: stock.locationId,
    locationName: extras.locationName ?? "",
    quantity: stock.quantity,
    reorderPoint: stock.reorderPoint,
    isLowStock: stock.quantity <= stock.reorderPoint,
    unitPrice: extras.unitPrice ?? 0,
    unit: extras.unit ?? "each",
  };
}

// ─── Locations CRUD ────────────────────────────────────────────────────────────

router.get("/inventory/locations", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(inventoryLocationsTable)
    .where(eq(inventoryLocationsTable.tenantId, tenantId))
    .orderBy(inventoryLocationsTable.name);
  res.json(rows.map(formatLocation));
});

router.post("/inventory/locations", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, type, isActive } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [loc] = await db.insert(inventoryLocationsTable).values({
    tenantId,
    name: String(name),
    description: description ? String(description) : null,
    type: type ?? "warehouse",
    isActive: isActive !== undefined ? isActive : true,
  }).returning();

  res.status(201).json(formatLocation(loc));
});

router.patch("/inventory/locations/:id", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, description, type, isActive } = req.body;
  const updates: Partial<typeof inventoryLocationsTable.$inferInsert> = {};
  if (name) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (type !== undefined) updates.type = type;
  if (isActive !== undefined) updates.isActive = isActive;

  const [updated] = await db.update(inventoryLocationsTable)
    .set(updates)
    .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatLocation(updated));
});

router.delete("/inventory/locations/:id", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(inventoryLocationsTable)
    .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ─── Location Stock ────────────────────────────────────────────────────────────

router.get("/inventory/locations/:id/stock", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId2 = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const locationId = parseInt(rawId2, 10);
  if (isNaN(locationId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select({
      stock: inventoryLocationStockTable,
      itemName: inventoryItemsTable.name,
      itemSku: inventoryItemsTable.sku,
      unitPrice: inventoryItemsTable.markedUpPrice,
      unit: inventoryItemsTable.unit,
      locationName: inventoryLocationsTable.name,
    })
    .from(inventoryLocationStockTable)
    .leftJoin(inventoryItemsTable, eq(inventoryLocationStockTable.inventoryItemId, inventoryItemsTable.id))
    .leftJoin(inventoryLocationsTable, eq(inventoryLocationStockTable.locationId, inventoryLocationsTable.id))
    .where(and(eq(inventoryLocationStockTable.locationId, locationId), eq(inventoryLocationStockTable.tenantId, tenantId)));

  res.json(rows.map(r => formatStockEntry(r.stock, {
    itemName: r.itemName ?? undefined,
    itemSku: r.itemSku ?? undefined,
    locationName: r.locationName ?? undefined,
    unitPrice: r.unitPrice ?? undefined,
    unit: r.unit ?? undefined,
  })));
});

router.post("/inventory/locations/:id/stock", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawLocId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const locationId = parseInt(rawLocId, 10);
  if (isNaN(locationId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { inventoryItemId, quantity, reorderPoint } = req.body;
  if (!inventoryItemId) { res.status(400).json({ error: "inventoryItemId is required" }); return; }

  const itemId = parseInt(String(inventoryItemId), 10);
  const qty = parseInt(String(quantity), 10);
  const reorder = reorderPoint !== undefined ? parseInt(String(reorderPoint), 10) : 5;

  // Verify location belongs to this tenant
  const [ownedLoc] = await db
    .select({ id: inventoryLocationsTable.id })
    .from(inventoryLocationsTable)
    .where(and(eq(inventoryLocationsTable.id, locationId), eq(inventoryLocationsTable.tenantId, tenantId)));
  if (!ownedLoc) { res.status(404).json({ error: "Location not found" }); return; }

  // Verify item belongs to this tenant
  const [ownedItem] = await db
    .select({ id: inventoryItemsTable.id })
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!ownedItem) { res.status(404).json({ error: "Inventory item not found" }); return; }

  // Upsert: find existing or insert new
  const [existing] = await db
    .select()
    .from(inventoryLocationStockTable)
    .where(and(
      eq(inventoryLocationStockTable.inventoryItemId, itemId),
      eq(inventoryLocationStockTable.locationId, locationId),
      eq(inventoryLocationStockTable.tenantId, tenantId)
    ));

  // Conflict-safe upsert using the unique constraint (tenant+item+location)
  const [stock] = await db
    .insert(inventoryLocationStockTable)
    .values({ tenantId, inventoryItemId: itemId, locationId, quantity: qty, reorderPoint: reorder })
    .onConflictDoUpdate({
      target: [
        inventoryLocationStockTable.tenantId,
        inventoryLocationStockTable.inventoryItemId,
        inventoryLocationStockTable.locationId,
      ],
      set: {
        quantity: qty,
        ...(reorderPoint !== undefined ? { reorderPoint: reorder } : {}),
      },
    })
    .returning();

  const [item] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)));
  const [loc] = await db.select().from(inventoryLocationsTable).where(and(eq(inventoryLocationsTable.id, locationId), eq(inventoryLocationsTable.tenantId, tenantId)));
  res.json(formatStockEntry(stock, {
    itemName: item?.name,
    itemSku: item?.sku,
    locationName: loc?.name,
    unitPrice: item?.markedUpPrice,
    unit: item?.unit,
  }));
});

// ─── Per-location stock adjustment ────────────────────────────────────────────
// POST /inventory/locations/:id/stock/adjust  body: { inventoryItemId, delta, reason? }

router.post("/inventory/locations/:id/stock/adjust", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawLocId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const locationId = parseInt(rawLocId, 10);
  if (isNaN(locationId)) { res.status(400).json({ error: "Invalid location id" }); return; }

  const { inventoryItemId, delta } = req.body;
  if (!inventoryItemId) { res.status(400).json({ error: "inventoryItemId is required" }); return; }
  const itemId = parseInt(String(inventoryItemId), 10);
  const d = parseInt(String(delta), 10);
  if (isNaN(d) || d === 0) { res.status(400).json({ error: "delta must be a non-zero integer" }); return; }

  // Pre-flight tenant ownership checks (read-only, outside transaction)
  const [[ownedLoc], [ownedItem]] = await Promise.all([
    db.select().from(inventoryLocationsTable)
      .where(and(eq(inventoryLocationsTable.id, locationId), eq(inventoryLocationsTable.tenantId, tenantId))),
    db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId))),
  ]);
  if (!ownedLoc) { res.status(404).json({ error: "Location not found" }); return; }
  if (!ownedItem) { res.status(404).json({ error: "Inventory item not found" }); return; }

  // Atomic: lock the stock row, validate, then update — prevents concurrent adjustments
  // from bypassing the non-negative check or overwriting each other.
  let updated: typeof inventoryLocationStockTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(inventoryLocationStockTable)
        .where(and(
          eq(inventoryLocationStockTable.inventoryItemId, itemId),
          eq(inventoryLocationStockTable.locationId, locationId),
          eq(inventoryLocationStockTable.tenantId, tenantId),
        ))
        .for("update");

      if (!locked) throw Object.assign(new Error("No stock record for this item at this location"), { statusCode: 404 });

      const newQty = locked.quantity + d;
      if (newQty < 0) throw Object.assign(new Error("Adjustment would result in negative quantity"), { statusCode: 400 });

      const [row] = await tx
        .update(inventoryLocationStockTable)
        .set({ quantity: newQty })
        .where(eq(inventoryLocationStockTable.id, locked.id))
        .returning();
      return row;
    });
  } catch (err: any) {
    res.status(err?.statusCode ?? 500).json({ error: err?.message ?? "Adjustment failed" });
    return;
  }

  res.json(formatStockEntry(updated, {
    itemName: ownedItem.name,
    itemSku: ownedItem.sku,
    locationName: ownedLoc.name,
    unitPrice: ownedItem.markedUpPrice,
    unit: ownedItem.unit,
  }));
});

// ─── Get stock breakdown by location for an inventory item ────────────────────

router.get("/inventory/:id/by-location", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const inventoryItemId = parseInt(req.params.id, 10);
  if (isNaN(inventoryItemId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select({
      stock: inventoryLocationStockTable,
      itemName: inventoryItemsTable.name,
      itemSku: inventoryItemsTable.sku,
      unitPrice: inventoryItemsTable.markedUpPrice,
      unit: inventoryItemsTable.unit,
      locationName: inventoryLocationsTable.name,
    })
    .from(inventoryLocationStockTable)
    .leftJoin(inventoryItemsTable, eq(inventoryLocationStockTable.inventoryItemId, inventoryItemsTable.id))
    .leftJoin(inventoryLocationsTable, eq(inventoryLocationStockTable.locationId, inventoryLocationsTable.id))
    .where(and(
      eq(inventoryLocationStockTable.inventoryItemId, inventoryItemId),
      eq(inventoryLocationStockTable.tenantId, tenantId)
    ));

  res.json(rows.map(r => formatStockEntry(r.stock, {
    itemName: r.itemName ?? undefined,
    itemSku: r.itemSku ?? undefined,
    locationName: r.locationName ?? undefined,
    unitPrice: r.unitPrice ?? undefined,
    unit: r.unit ?? undefined,
  })));
});

// ─── Stock Transfer ────────────────────────────────────────────────────────────

router.post("/inventory/transfer", requireAdmin, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { inventoryItemId, fromLocationId, toLocationId, quantity, reason } = req.body;

  if (!inventoryItemId || !toLocationId || !quantity || quantity <= 0) {
    res.status(400).json({ error: "inventoryItemId, toLocationId, and positive quantity are required" });
    return;
  }

  const itemId = parseInt(String(inventoryItemId), 10);
  const toLocId = parseInt(String(toLocationId), 10);
  const qty = parseInt(String(quantity), 10);
  const fromLocId = fromLocationId ? parseInt(String(fromLocationId), 10) : null;

  // Pre-flight tenant ownership checks (outside transaction — read-only, no contention)
  const [ownedItem] = await db.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!ownedItem) { res.status(404).json({ error: "Inventory item not found" }); return; }

  const [ownedToLoc] = await db.select().from(inventoryLocationsTable)
    .where(and(eq(inventoryLocationsTable.id, toLocId), eq(inventoryLocationsTable.tenantId, tenantId)));
  if (!ownedToLoc) { res.status(404).json({ error: "Destination location not found" }); return; }

  if (fromLocId) {
    const [ownedFromLoc] = await db.select().from(inventoryLocationsTable)
      .where(and(eq(inventoryLocationsTable.id, fromLocId), eq(inventoryLocationsTable.tenantId, tenantId)));
    if (!ownedFromLoc) { res.status(404).json({ error: "Source location not found" }); return; }
  }

  // ── Atomic transfer inside a transaction ──────────────────────────────────
  type TransferResult = {
    fromStock: typeof inventoryLocationStockTable.$inferSelect | null;
    toStock: typeof inventoryLocationStockTable.$inferSelect;
    refreshedItem: typeof inventoryItemsTable.$inferSelect;
  };

  let result: TransferResult;
  try {
    result = await db.transaction(async (tx) => {
      let fromStockRow: typeof inventoryLocationStockTable.$inferSelect | null = null;

      if (fromLocId) {
        // Lock the source stock row, check & decrement
        const [srcStock] = await tx
          .select()
          .from(inventoryLocationStockTable)
          .where(and(
            eq(inventoryLocationStockTable.inventoryItemId, itemId),
            eq(inventoryLocationStockTable.locationId, fromLocId),
            eq(inventoryLocationStockTable.tenantId, tenantId)
          ))
          .for("update");
        if (!srcStock) throw Object.assign(new Error("Source location has no stock for this item"), { statusCode: 404 });
        if (srcStock.quantity < qty) throw Object.assign(new Error("Insufficient stock at source location"), { statusCode: 400 });

        const [updated] = await tx.update(inventoryLocationStockTable)
          .set({ quantity: srcStock.quantity - qty })
          .where(eq(inventoryLocationStockTable.id, srcStock.id))
          .returning();
        fromStockRow = updated;
      } else {
        // Lock and decrement main warehouse stock
        const [lockedItem] = await tx.select().from(inventoryItemsTable)
          .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)))
          .for("update");
        if (!lockedItem || lockedItem.quantity < qty) {
          throw Object.assign(new Error("Insufficient stock in main warehouse"), { statusCode: 400 });
        }
        await tx.update(inventoryItemsTable)
          .set({ quantity: lockedItem.quantity - qty })
          .where(eq(inventoryItemsTable.id, itemId));
      }

      // Conflict-safe upsert for destination stock (unique constraint: tenant+item+location)
      const [toStockRow] = await tx
        .insert(inventoryLocationStockTable)
        .values({ tenantId, inventoryItemId: itemId, locationId: toLocId, quantity: qty, reorderPoint: 5 })
        .onConflictDoUpdate({
          target: [
            inventoryLocationStockTable.tenantId,
            inventoryLocationStockTable.inventoryItemId,
            inventoryLocationStockTable.locationId,
          ],
          set: { quantity: sql`${inventoryLocationStockTable.quantity} + ${qty}` },
        })
        .returning();

      // Log the transfer
      await tx.insert(inventoryTransfersTable).values({
        tenantId,
        inventoryItemId: itemId,
        fromLocationId: fromLocId ?? null,
        toLocationId: toLocId,
        quantity: qty,
        reason: reason ? String(reason) : null,
      });

      const [refreshedItem] = await tx.select().from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, itemId));

      return { fromStock: fromStockRow, toStock: toStockRow, refreshedItem };
    });
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    res.status(status).json({ error: err?.message ?? "Transfer failed" });
    return;
  }

  const { fromStock, toStock, refreshedItem } = result;

  let fromLocName: string | undefined;
  if (fromLocId) {
    const [fromLoc] = await db.select().from(inventoryLocationsTable)
      .where(eq(inventoryLocationsTable.id, fromLocId));
    fromLocName = fromLoc?.name;
  }

  res.json({
    inventoryItemId: itemId,
    quantity: qty,
    fromLocationId: fromLocId,
    toLocationId: toLocId,
    mainWarehouseQuantity: refreshedItem?.quantity ?? null,
    from: fromStock ? formatStockEntry(fromStock, {
      itemName: refreshedItem?.name,
      itemSku: refreshedItem?.sku,
      locationName: fromLocName,
      unitPrice: refreshedItem?.markedUpPrice,
      unit: refreshedItem?.unit,
    }) : null,
    to: formatStockEntry(toStock, {
      itemName: refreshedItem?.name,
      itemSku: refreshedItem?.sku,
      locationName: ownedToLoc?.name,
      unitPrice: refreshedItem?.markedUpPrice,
      unit: refreshedItem?.unit,
    }),
  });
});

export default router;
