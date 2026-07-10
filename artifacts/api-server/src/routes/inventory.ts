import { Router, type IRouter } from "express";
import { db, inventoryItemsTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatItem(i: typeof inventoryItemsTable.$inferSelect) {
  return {
    ...i,
    isLowStock: i.quantity <= i.reorderPoint,
    createdAt: i.createdAt.toISOString(),
  };
}

router.get("/inventory/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));

  const totalItems = items.length;
  const totalValue = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const lowStockCount = items.filter(i => i.quantity <= i.reorderPoint).length;

  const catMap: Record<string, number> = {};
  for (const item of items) {
    const cat = item.category ?? "Uncategorized";
    catMap[cat] = (catMap[cat] ?? 0) + 1;
  }
  const categories = Object.entries(catMap).map(([category, count]) => ({ category, count }));

  res.json({ totalItems, totalValue, lowStockCount, categories });
});

router.get("/inventory", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { q, category, lowStock } = req.query as Record<string, string>;

  let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (q) where = and(where, ilike(inventoryItemsTable.name, `%${q}%`)) as typeof where;
  if (category) where = and(where, eq(inventoryItemsTable.category, category)) as typeof where;

  const items = await db.select().from(inventoryItemsTable).where(where).orderBy(inventoryItemsTable.name);
  const formatted = items.map(formatItem);

  if (lowStock === "true") {
    res.json(formatted.filter(i => i.isLowStock));
    return;
  }
  res.json(formatted);
});

router.post("/inventory", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, sku, description, category, unitPrice, quantity, reorderPoint, unit } = req.body;
  if (!name || !sku) {
    res.status(400).json({ error: "name and sku are required" });
    return;
  }

  const [item] = await db.insert(inventoryItemsTable).values({
    tenantId,
    name,
    sku,
    description: description ?? null,
    category: category ?? null,
    unitPrice: parseFloat(unitPrice) || 0,
    markedUpPrice: parseFloat(unitPrice) * 1.2 || 0,
    quantity: parseInt(quantity, 10) || 0,
    reorderPoint: reorderPoint ? parseInt(reorderPoint, 10) : 5,
    unit: unit ?? "each",
    isLowStock: false,
  }).returning();

  res.status(201).json(formatItem(item));
});

router.get("/inventory/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [item] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatItem(item));
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, description, category, unitPrice, quantity, reorderPoint, unit } = req.body;
  const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (unitPrice !== undefined) { updates.unitPrice = parseFloat(unitPrice); updates.markedUpPrice = parseFloat(unitPrice) * 1.2; }
  if (quantity !== undefined) updates.quantity = parseInt(quantity, 10);
  if (reorderPoint !== undefined) updates.reorderPoint = parseInt(reorderPoint, 10);
  if (unit !== undefined) updates.unit = unit;

  const [updated] = await db.update(inventoryItemsTable).set(updates).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatItem(updated));
});

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
