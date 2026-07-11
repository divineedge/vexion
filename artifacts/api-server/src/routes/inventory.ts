import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, inventoryItemsTable, tenantsTable } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { usersTable } from "@workspace/db";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const inventoryImportExportConfig: ImportExportEntityConfig = {
  entityKey: "inventory",
  fields: [
    { key: "name", header: "Name", required: true },
    { key: "sku", header: "SKU", required: true, hint: "Used to match an existing item" },
    { key: "description", header: "Description" },
    { key: "category", header: "Category" },
    { key: "unitPrice", header: "Cost Price" },
    { key: "markedUpPrice", header: "Sell Price" },
    { key: "quantity", header: "Quantity" },
    { key: "reorderPoint", header: "Reorder Point" },
    { key: "unit", header: "Unit" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "name", header: "Name" },
    { key: "sku", header: "SKU" },
    { key: "description", header: "Description" },
    { key: "category", header: "Category" },
    { key: "unitPrice", header: "Cost Price" },
    { key: "markedUpPrice", header: "Sell Price" },
    { key: "quantity", header: "Quantity" },
    { key: "reorderPoint", header: "Reorder Point" },
    { key: "unit", header: "Unit" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.q) where = and(where, ilike(inventoryItemsTable.name, `%${query.q}%`)) as typeof where;
    if (query.category) where = and(where, eq(inventoryItemsTable.category, query.category)) as typeof where;

    const rows = await db.select().from(inventoryItemsTable).where(where).orderBy(inventoryItemsTable.name);
    return rows.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      description: i.description ?? "",
      category: i.category ?? "",
      unitPrice: i.unitPrice,
      markedUpPrice: i.markedUpPrice,
      quantity: i.quantity,
      reorderPoint: i.reorderPoint,
      unit: i.unit,
      createdAt: i.createdAt.toISOString(),
    }));
  },
  parseRow: async (_tenantId, raw) => {
    const errors: string[] = [];
    const name = requireString(raw.name, "Name", errors);
    const sku = requireString(raw.sku, "SKU", errors);
    if (errors.length > 0 || !name || !sku) return { ok: false, errors };

    const unitPrice = optionalNumber(raw.unitPrice, "Cost Price", errors) ?? 0;
    const markedUpPrice = optionalNumber(raw.markedUpPrice, "Sell Price", errors) ?? unitPrice;
    const values = {
      name,
      sku,
      description: optionalString(raw.description) ?? null,
      category: optionalString(raw.category) ?? null,
      unitPrice,
      markedUpPrice,
      quantity: optionalNumber(raw.quantity, "Quantity", errors) ?? 0,
      reorderPoint: optionalNumber(raw.reorderPoint, "Reorder Point", errors) ?? 5,
      unit: optionalString(raw.unit) ?? "each",
    };
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, values };
  },
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: inventoryItemsTable.id })
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), ilike(inventoryItemsTable.sku, values.sku as string)))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    await db.insert(inventoryItemsTable).values({ tenantId, ...values } as typeof inventoryItemsTable.$inferInsert);
  },
  update: async (tenantId, id, values) => {
    await db.update(inventoryItemsTable).set(values as Partial<typeof inventoryItemsTable.$inferInsert>)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  },
};

router.get("/inventory/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), inventoryImportExportConfig);
});

router.post("/inventory/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), inventoryImportExportConfig);
});

router.post("/inventory/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), inventoryImportExportConfig);
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getTenantMarkupPct(tenantId: number): Promise<number> {
  const [tenant] = await db
    .select({ defaultMarkupPct: tenantsTable.defaultMarkupPct })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return tenant?.defaultMarkupPct ?? 20;
}

/** Returns { role } or null if user not found in this tenant */
async function getUserRole(tenantId: number, userId: number): Promise<string | null> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return user?.role ?? null;
}

/**
 * Any role except technician may always see cost price.
 * Technicians see it only when the tenant has enabled `showCostPriceToTech`.
 */
async function canSeeCostPrice(tenantId: number, userId: number): Promise<boolean> {
  const role = await getUserRole(tenantId, userId);
  if (!role) return false;
  if (role !== "technician") return true;
  const [tenant] = await db
    .select({ showCostPriceToTech: tenantsTable.showCostPriceToTech })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return tenant?.showCostPriceToTech ?? false;
}

/**
 * Guard middleware: technicians may not mutate inventory.
 */
async function requireInventoryMutate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getUserRole(tenantId, userId);
  if (role === "technician") {
    res.status(403).json({ error: "Technicians cannot modify inventory" });
    return;
  }
  next();
}

/**
 * Compute the stored markup from DB values.
 */
function storedMarkupPct(costPrice: number, sellPrice: number, tenantDefault: number): number {
  if (costPrice === 0) return tenantDefault;
  return Math.round(((sellPrice / costPrice) - 1) * 100 * 100) / 100;
}

function formatItem(
  i: typeof inventoryItemsTable.$inferSelect,
  tenantMarkupPct: number,
  includeCostPrice: boolean,
) {
  const costPrice = i.unitPrice;     // DB unitPrice = what we pay
  const sellPrice = i.markedUpPrice; // DB markedUpPrice = what we charge
  const markup = storedMarkupPct(costPrice, sellPrice, tenantMarkupPct);
  return {
    id: i.id,
    tenantId: i.tenantId,
    name: i.name,
    sku: i.sku,
    description: i.description,
    category: i.category,
    costPrice: includeCostPrice ? costPrice : null,
    unitPrice: sellPrice,
    markupPct: markup,
    markedUpPrice: sellPrice,
    quantity: i.quantity,
    reorderPoint: i.reorderPoint,
    unit: i.unit,
    isLowStock: i.quantity <= i.reorderPoint,
    createdAt: i.createdAt.toISOString(),
  };
}

function parseSafeFloat(val: unknown, fallback: number): number {
  const n = parseFloat(String(val));
  return isNaN(n) ? fallback : n;
}

function parseSafeInt(val: unknown, fallback: number): number {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

// ─── routes ───────────────────────────────────────────────────────────────────

router.get("/inventory/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.tenantId, tenantId));

  const totalItems = items.length;
  const totalValue = items.reduce((sum, i) => sum + i.markedUpPrice * i.quantity, 0);
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
  const userId = getUserId(req);
  const { q, category, lowStock } = req.query as Record<string, string>;

  let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (q) where = and(where, ilike(inventoryItemsTable.name, `%${q}%`)) as typeof where;
  if (category) where = and(where, eq(inventoryItemsTable.category, category)) as typeof where;

  const [items, markupPct, showCost] = await Promise.all([
    db.select().from(inventoryItemsTable).where(where).orderBy(inventoryItemsTable.name),
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);

  const formatted = items.map(i => formatItem(i, markupPct, showCost));

  if (lowStock === "true") {
    res.json(formatted.filter(i => i.isLowStock));
    return;
  }
  res.json(formatted);
});

router.post("/inventory", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { name, sku, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit } = req.body;

  if (!name || !sku) {
    res.status(400).json({ error: "name and sku are required" });
    return;
  }

  const tenantMarkupPct = await getTenantMarkupPct(tenantId);
  const effectiveMarkupPct = reqMarkupPct != null ? parseSafeFloat(reqMarkupPct, tenantMarkupPct) : tenantMarkupPct;
  const costVal = parseSafeFloat(costPrice, 0);
  if (costVal < 0) { res.status(400).json({ error: "costPrice must be >= 0" }); return; }
  if (effectiveMarkupPct < 0) { res.status(400).json({ error: "markupPct must be >= 0" }); return; }
  const sellPrice = costVal * (1 + effectiveMarkupPct / 100);
  const qty = parseSafeInt(quantity, 0);
  const reorder = parseSafeInt(reorderPoint, 5);

  const [item] = await db.insert(inventoryItemsTable).values({
    tenantId,
    name: String(name),
    sku: String(sku),
    description: description ? String(description) : null,
    category: category ? String(category) : null,
    unitPrice: costVal,
    markedUpPrice: sellPrice,
    quantity: qty,
    reorderPoint: reorder,
    unit: unit ? String(unit) : "each",
    isLowStock: qty <= reorder,
  }).returning();

  const showCost = await canSeeCostPrice(tenantId, userId);
  res.status(201).json(formatItem(item, tenantMarkupPct, showCost));
});

router.get("/inventory/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item, markupPct, showCost] = await Promise.all([
    db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)))
      .then(r => r[0]),
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatItem(item, markupPct, showCost));
});

router.patch("/inventory/:id", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (req.body.costPrice !== undefined) {
    const c = parseSafeFloat(req.body.costPrice, NaN);
    if (isNaN(c) || c < 0) { res.status(400).json({ error: "costPrice must be a non-negative number" }); return; }
  }
  if (req.body.markupPct !== undefined) {
    const m = parseSafeFloat(req.body.markupPct, NaN);
    if (isNaN(m) || m < 0) { res.status(400).json({ error: "markupPct must be a non-negative number" }); return; }
  }

  const { name, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit } = req.body;
  const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (category !== undefined) updates.category = category ? String(category) : null;
  if (quantity !== undefined) { updates.quantity = parseSafeInt(quantity, 0); }
  if (reorderPoint !== undefined) { updates.reorderPoint = parseSafeInt(reorderPoint, 5); }
  if (unit !== undefined) updates.unit = String(unit) || "each";

  if (costPrice !== undefined || reqMarkupPct !== undefined) {
    const [existing] = await db
      .select()
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const tenantDefault = await getTenantMarkupPct(tenantId);
    const existingMarkup = storedMarkupPct(existing.unitPrice, existing.markedUpPrice, tenantDefault);
    const costVal = costPrice !== undefined ? parseSafeFloat(costPrice, existing.unitPrice) : existing.unitPrice;
    const effectiveMarkupPct = reqMarkupPct != null ? parseSafeFloat(reqMarkupPct, existingMarkup) : existingMarkup;
    updates.unitPrice = costVal;
    updates.markedUpPrice = costVal * (1 + effectiveMarkupPct / 100);
  }

  if (updates.quantity !== undefined || updates.reorderPoint !== undefined) {
    if (updates.quantity === undefined || updates.reorderPoint === undefined) {
      const [existing] = await db
        .select({ quantity: inventoryItemsTable.quantity, reorderPoint: inventoryItemsTable.reorderPoint })
        .from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
      if (existing) {
        const qty = updates.quantity ?? existing.quantity;
        const reorder = updates.reorderPoint ?? existing.reorderPoint;
        updates.isLowStock = qty <= reorder;
      }
    } else {
      updates.isLowStock = (updates.quantity as number) <= (updates.reorderPoint as number);
    }
  }

  const [updated] = await db
    .update(inventoryItemsTable)
    .set(updates)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [markupPct, showCost] = await Promise.all([
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);
  res.json(formatItem(updated, markupPct, showCost));
});

// ── Stock adjustment ──────────────────────────────────────────────────────────
// POST /inventory/:id/adjust-stock  body: { delta: number, reason?: string }
// delta > 0 = receiving stock; delta < 0 = consuming/removing stock
router.post("/inventory/:id/adjust-stock", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const delta = parseSafeInt(req.body.delta, NaN);
  if (isNaN(delta) || delta === 0) {
    res.status(400).json({ error: "delta must be a non-zero integer" });
    return;
  }

  const [existing] = await db.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const newQty = existing.quantity + delta;
  if (newQty < 0) {
    res.status(400).json({ error: "Stock adjustment would result in negative quantity" });
    return;
  }

  const [updated] = await db.update(inventoryItemsTable)
    .set({ quantity: newQty, isLowStock: newQty <= existing.reorderPoint })
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)))
    .returning();

  const [markupPct, showCost] = await Promise.all([
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);
  res.json(formatItem(updated, markupPct, showCost));
});

router.delete("/inventory/:id", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .delete(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
