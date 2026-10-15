import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, inventoryItemsTable, inventorySuppliersTable, tenantsTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
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
  optionalBoolean,
  registerImportExportConfig,
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
    { key: "availableForBlueprint", header: "Blueprint Ready" },
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
    { key: "availableForBlueprint", header: "Blueprint Ready" },
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
      availableForBlueprint: i.availableForBlueprint,
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
      availableForBlueprint: optionalBoolean(raw.availableForBlueprint) ?? false,
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
    const [row] = await db.insert(inventoryItemsTable).values({ tenantId, ...values } as typeof inventoryItemsTable.$inferInsert).returning({ id: inventoryItemsTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    await db.update(inventoryItemsTable).set(values as Partial<typeof inventoryItemsTable.$inferInsert>)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  },
};
registerImportExportConfig(inventoryImportExportConfig);

router.get("/inventory/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), inventoryImportExportConfig);
});

router.post("/inventory/import/preview", requireInventoryMutate, importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), inventoryImportExportConfig);
});

router.post("/inventory/import/commit", requireInventoryMutate, importUpload.single("file"), async (req, res): Promise<void> => {
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
  supplierName?: string | null,
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
    availableForBlueprint: i.availableForBlueprint,
    commissionPct: i.commissionPct ?? null,
    supplierId: i.supplierId ?? null,
    supplierName: supplierName ?? null,
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

// ─── Supplier CRUD ────────────────────────────────────────────────────────────

router.get("/inventory/suppliers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const suppliers = await db
    .select()
    .from(inventorySuppliersTable)
    .where(eq(inventorySuppliersTable.tenantId, tenantId))
    .orderBy(inventorySuppliersTable.name);
  res.json(suppliers.map(s => ({
    id: s.id, tenantId: s.tenantId, name: s.name,
    contact: s.contact ?? null, accountNumber: s.accountNumber ?? null, notes: s.notes ?? null,
    createdAt: s.createdAt.toISOString(),
  })));
});

router.post("/inventory/suppliers", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, contact, accountNumber, notes } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [s] = await db.insert(inventorySuppliersTable).values({
    tenantId, name: String(name),
    contact: contact ? String(contact) : null,
    accountNumber: accountNumber ? String(accountNumber) : null,
    notes: notes ? String(notes) : null,
  }).returning();
  res.status(201).json({
    id: s.id, tenantId: s.tenantId, name: s.name,
    contact: s.contact ?? null, accountNumber: s.accountNumber ?? null, notes: s.notes ?? null,
    createdAt: s.createdAt.toISOString(),
  });
});

router.patch("/inventory/suppliers/:id", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Partial<typeof inventorySuppliersTable.$inferInsert> = {};
  if (req.body.name !== undefined) updates.name = String(req.body.name);
  if (req.body.contact !== undefined) updates.contact = req.body.contact ? String(req.body.contact) : null;
  if (req.body.accountNumber !== undefined) updates.accountNumber = req.body.accountNumber ? String(req.body.accountNumber) : null;
  if (req.body.notes !== undefined) updates.notes = req.body.notes ? String(req.body.notes) : null;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [s] = await db.update(inventorySuppliersTable).set(updates)
    .where(and(eq(inventorySuppliersTable.id, id), eq(inventorySuppliersTable.tenantId, tenantId)))
    .returning();
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  res.json({
    id: s.id, tenantId: s.tenantId, name: s.name,
    contact: s.contact ?? null, accountNumber: s.accountNumber ?? null, notes: s.notes ?? null,
    createdAt: s.createdAt.toISOString(),
  });
});

router.delete("/inventory/suppliers/:id", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(inventorySuppliersTable)
    .where(and(eq(inventorySuppliersTable.id, id), eq(inventorySuppliersTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ─── Main inventory list ───────────────────────────────────────────────────────

router.get("/inventory", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { q, category, lowStock, availableForBlueprint } = req.query as Record<string, string>;

  let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (q) where = and(where, ilike(inventoryItemsTable.name, `%${q}%`)) as typeof where;
  if (category) where = and(where, eq(inventoryItemsTable.category, category)) as typeof where;
  if (availableForBlueprint === "true") where = and(where, eq(inventoryItemsTable.availableForBlueprint, true)) as typeof where;

  const [items, markupPct, showCost, suppliers] = await Promise.all([
    db.select().from(inventoryItemsTable).where(where).orderBy(inventoryItemsTable.name),
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
    db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable)
      .where(eq(inventorySuppliersTable.tenantId, tenantId)),
  ]);

  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  const formatted = items.map(i => formatItem(i, markupPct, showCost, i.supplierId ? supplierMap.get(i.supplierId) : null));

  if (lowStock === "true") {
    res.json(formatted.filter(i => i.isLowStock));
    return;
  }
  res.json(formatted);
});

router.post("/inventory", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { name, sku, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit, availableForBlueprint, commissionPct: reqCommissionPct, supplierId: reqSupplierId } = req.body;

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
  const commissionPctVal = reqCommissionPct != null ? parseSafeFloat(reqCommissionPct, 0) : null;

  // Validate supplierId belongs to this tenant
  let resolvedSupplierId: number | null = null;
  let supplierName: string | null = null;
  if (reqSupplierId != null) {
    const sid = parseSafeInt(reqSupplierId, NaN);
    if (!isNaN(sid)) {
      const [sup] = await db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
        .from(inventorySuppliersTable)
        .where(and(eq(inventorySuppliersTable.id, sid), eq(inventorySuppliersTable.tenantId, tenantId)));
      if (!sup) { res.status(400).json({ error: "Supplier not found" }); return; }
      resolvedSupplierId = sup.id;
      supplierName = sup.name;
    }
  }

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
    availableForBlueprint: availableForBlueprint === true || availableForBlueprint === "true",
    commissionPct: commissionPctVal,
    supplierId: resolvedSupplierId,
  }).returning();

  const showCost = await canSeeCostPrice(tenantId, userId);
  res.status(201).json(formatItem(item, tenantMarkupPct, showCost, supplierName));
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

  let supplierName: string | null = null;
  if (item.supplierId) {
    const [sup] = await db.select({ name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable)
      .where(and(eq(inventorySuppliersTable.id, item.supplierId), eq(inventorySuppliersTable.tenantId, tenantId)));
    supplierName = sup?.name ?? null;
  }
  res.json(formatItem(item, markupPct, showCost, supplierName));
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

  const { name, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit, availableForBlueprint, commissionPct: reqCommissionPct, supplierId: reqSupplierId } = req.body;
  const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (category !== undefined) updates.category = category ? String(category) : null;
  if (quantity !== undefined) { updates.quantity = parseSafeInt(quantity, 0); }
  if (reorderPoint !== undefined) { updates.reorderPoint = parseSafeInt(reorderPoint, 5); }
  if (unit !== undefined) updates.unit = String(unit) || "each";
  if (availableForBlueprint !== undefined) updates.availableForBlueprint = availableForBlueprint === true || availableForBlueprint === "true";
  if (reqCommissionPct !== undefined) updates.commissionPct = reqCommissionPct != null ? parseSafeFloat(reqCommissionPct, 0) : null;

  // Validate supplierId belongs to this tenant before accepting it
  let patchedSupplierName: string | null | undefined = undefined; // undefined = not changing
  if (reqSupplierId !== undefined) {
    if (reqSupplierId == null) {
      updates.supplierId = null;
      patchedSupplierName = null;
    } else {
      const sid = parseSafeInt(reqSupplierId, NaN);
      if (isNaN(sid)) { res.status(400).json({ error: "Invalid supplierId" }); return; }
      const [sup] = await db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
        .from(inventorySuppliersTable)
        .where(and(eq(inventorySuppliersTable.id, sid), eq(inventorySuppliersTable.tenantId, tenantId)));
      if (!sup) { res.status(400).json({ error: "Supplier not found" }); return; }
      updates.supplierId = sup.id;
      patchedSupplierName = sup.name;
    }
  }

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

  // Resolve supplier name: use already-validated name if supplierId was changed,
  // otherwise look up existing supplierId (tenant-scoped).
  let supplierName: string | null = null;
  if (patchedSupplierName !== undefined) {
    supplierName = patchedSupplierName;
  } else if (updated.supplierId) {
    const [sup] = await db.select({ name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable)
      .where(and(eq(inventorySuppliersTable.id, updated.supplierId), eq(inventorySuppliersTable.tenantId, tenantId)));
    supplierName = sup?.name ?? null;
  }
  res.json(formatItem(updated, markupPct, showCost, supplierName));
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
    .set({ quantity: sql`${inventoryItemsTable.quantity}+${delta}`, isLowStock: sql`${inventoryItemsTable.quantity}+${delta}<=${inventoryItemsTable.reorderPoint}` })
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId),sql`${inventoryItemsTable.quantity}+${delta}>=0`))
    .returning();
  if(!updated){res.status(409).json({error:'Stock changed. Refresh the item and try again.'});return;}

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
