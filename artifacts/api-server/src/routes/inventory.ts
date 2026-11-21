import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, inventoryItemsTable, inventoryPartSizesTable, inventoryPartTypesTable, inventorySuppliersTable, tenantsTable, vendorsTable } from "@workspace/db";
import { displayInventoryUnit } from "../lib/chemicalInventory";
import { parseLinkedPartsBody } from "../lib/inventoryKits";
import { linkedPartsByParent, saveLinkedPartsFromBody, type LinkedPartsView } from "../lib/inventoryKitStore";
import { lowStockItems, parseReorderPoint, readStockAlerts, stockNeedsReorder } from "../lib/reorderPoint";
import { eq, and, or, ilike, sql, inArray, ne } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { applyArrival, isPipeTypeName, parseOptionalAmount, priceWithMarkup, resolveInventorySell } from "../lib/pipeStock";
import { applyQuantityDelta, planDuplicates, stockOwnerId, withSharedQuantity } from "../lib/inventoryDuplicate";
import { inventoryImportFields, inventoryRecordFromImport, parseInventoryImportRow } from "../lib/inventoryImport";
import { usersTable } from "@workspace/db";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  registerImportExportConfig,
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const inventoryImportExportConfig: ImportExportEntityConfig = {
  entityKey: "inventory",
  fields: inventoryImportFields,
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "name", header: "Name" },
    { key: "sku", header: "SKU" },
    { key: "typeName", header: "Type" },
    { key: "sizeName", header: "Size" },
    { key: "category", header: "Category" },
    { key: "quantity", header: "Quantity" },
    { key: "unitPrice", header: "Cost" },
    { key: "markedUpPrice", header: "Sell Price" },
    { key: "supplierName", header: "Supplier" },
    { key: "lengthReceived", header: "Pipe Feet" },
    { key: "pricePerFoot", header: "Price Per Foot" },
    { key: "description", header: "Description" },
    { key: "reorderPoint", header: "Reorder Point" },
    { key: "unit", header: "Unit" },
    { key: "availableForBlueprint", header: "Blueprint Ready" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.q) where = and(where, or(ilike(inventoryItemsTable.name, `%${query.q}%`),ilike(inventoryItemsTable.sku, `%${query.q}%`))) as typeof where;
    if (query.category) where = and(where, eq(inventoryItemsTable.category, query.category)) as typeof where;

    const rows = await db.select({
      item: inventoryItemsTable,
      typeName: inventoryPartTypesTable.name,
      sizeName: inventoryPartSizesTable.name,
      vendorName: vendorsTable.name,
    }).from(inventoryItemsTable)
      .leftJoin(inventoryPartTypesTable, eq(inventoryItemsTable.typeId, inventoryPartTypesTable.id))
      .leftJoin(inventoryPartSizesTable, eq(inventoryItemsTable.sizeId, inventoryPartSizesTable.id))
      .leftJoin(vendorsTable, eq(inventoryItemsTable.vendorId, vendorsTable.id))
      .where(where)
      .orderBy(inventoryItemsTable.name);
    const quantities = await ownerQuantities(tenantId, rows.map(row => row.item));
    return rows.map(({ item, typeName, sizeName, vendorName }) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      typeName: typeName ?? "",
      sizeName: sizeName ?? "",
      description: item.description ?? "",
      category: item.category ?? "",
      unitPrice: item.unitPrice,
      markedUpPrice: item.markedUpPrice,
      quantity: withSharedQuantity(item, quantities.get(stockOwnerId(item))).quantity,
      reorderPoint: item.reorderPoint,
      unit: item.unit,
      supplierName: vendorName ?? "",
      lengthReceived: item.lengthReceived ?? "",
      pricePerFoot: item.pricePerFoot ?? "",
      availableForBlueprint: item.availableForBlueprint,
      createdAt: item.createdAt.toISOString(),
    }));
  },
  parseRow: async (_tenantId, raw) => parseInventoryImportRow(raw),
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: inventoryItemsTable.id })
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), ilike(inventoryItemsTable.sku, values.sku as string)))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const record = await inventoryRecordFromImport(tenantId, values, "insert");
    const [row] = await db.insert(inventoryItemsTable).values({ tenantId, ...record } as typeof inventoryItemsTable.$inferInsert).returning({ id: inventoryItemsTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    const record = await inventoryRecordFromImport(tenantId, values, "update");
    if (record.quantity !== undefined || record.reorderPoint !== undefined) {
      const [existing] = await db.select({ quantity: inventoryItemsTable.quantity, reorderPoint: inventoryItemsTable.reorderPoint, stockAlerts: inventoryItemsTable.stockAlerts })
        .from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
      if (existing) {
        const quantity = record.quantity ?? existing.quantity;
        const reorderPoint = record.reorderPoint ?? existing.reorderPoint;
        record.isLowStock = stockNeedsReorder(quantity, reorderPoint, existing.stockAlerts);
      }
    }
    await db.update(inventoryItemsTable).set(record)
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

function formatItem(
  i: typeof inventoryItemsTable.$inferSelect,
  tenantMarkupPct: number,
  includeCostPrice: boolean,
  supplierName?: string | null,
  grouping?: { typeName: string | null; sizeName: string | null; lengthUnit?: string | null },
  vendorName?: string | null,
  linkedParts?: LinkedPartsView | null,
) {
  const costPrice = i.unitPrice;     // DB unitPrice = what we pay
  const priced = resolveInventorySell({
    cost: costPrice,
    pricePerFoot: i.pricePerFoot,
    markedUpPrice: i.markedUpPrice,
    defaultMarkupPct: tenantMarkupPct,
    itemMarkupPct: i.markupPct,
  });
  const sellPrice = priced.sellPrice;
  const markup = priced.markupPct;
  const resolvedVendor = vendorName ?? null;
  return {
    id: i.id,
    tenantId: i.tenantId,
    name: i.name,
    sku: i.sku,
    description: i.description,
    category: i.category,
    typeId: i.typeId ?? null,
    typeName: grouping?.typeName ?? null,
    sizeId: i.sizeId ?? null,
    sizeName: grouping?.sizeName ?? null,
    lengthReceived: i.lengthReceived ?? null,
    pricePerFoot: priced.pricePerFoot,
    vendorId: i.vendorId ?? null,
    vendorName: resolvedVendor,
    costPrice: includeCostPrice ? costPrice : null,
    unitPrice: sellPrice,
    markupPct: markup,
    usesDefaultMarkup: priced.usesDefaultMarkup,
    markedUpPrice: sellPrice,
    quantity: i.quantity,
    reorderPoint: i.reorderPoint,
    unit: displayInventoryUnit(grouping?.sizeName, i.unit, i.pricePerFoot, grouping?.lengthUnit),
    stockAlerts: i.stockAlerts !== false,
    isLowStock: stockNeedsReorder(i.quantity, i.reorderPoint, i.stockAlerts !== false),
    linkedParts: linkedParts ?? null,
    availableForBlueprint: i.availableForBlueprint,
    commissionPct: i.commissionPct ?? null,
    supplierId: i.supplierId ?? null,
    supplierName: resolvedVendor ?? supplierName ?? null,
    stockItemId: i.stockItemId ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

async function ownerQuantities(
  tenantId: number,
  items: readonly { id: number; stockItemId: number | null; quantity: number }[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const item of items) {
    if (item.stockItemId == null) map.set(item.id, item.quantity);
  }
  const missing = [...new Set(items.flatMap(item => (
    item.stockItemId != null && !map.has(item.stockItemId) ? [item.stockItemId] : []
  )))];
  if (missing.length === 0) return map;
  const owners = await db.select({ id: inventoryItemsTable.id, quantity: inventoryItemsTable.quantity })
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.tenantId, tenantId), inArray(inventoryItemsTable.id, missing)));
  for (const owner of owners) map.set(owner.id, owner.quantity);
  return map;
}

async function syncFamilyLowStock(tenantId: number, ownerId: number, quantity: number): Promise<void> {
  await db.update(inventoryItemsTable).set({
    isLowStock: sql`${inventoryItemsTable.stockAlerts} AND ${quantity} <= ${inventoryItemsTable.reorderPoint}`,
  }).where(and(
    eq(inventoryItemsTable.tenantId, tenantId),
    or(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.stockItemId, ownerId)),
  ));
}

function parseSafeFloat(val: unknown, fallback: number): number {
  const n = parseFloat(String(val));
  return isNaN(n) ? fallback : n;
}

function parseSafeInt(val: unknown, fallback: number): number {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

/** Inventory quantity may be fractional for gallons, ounces, and pounds. */
function parseStockQuantity(val: unknown): number | null {
  if (typeof val === "string" && val.trim() === "") return null;
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000) / 1_000_000;
}

type ResolvedGrouping = {
  typeId: number | null;
  sizeId: number | null;
  typeName: string | null;
  sizeName: string | null;
  lengthUnit: string | null;
};

function nullableId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseSafeInt(value, NaN);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Resolve a part's type and a size from the shared catalog. Both may be empty. */
async function resolveGrouping(
  tenantId: number,
  typeIdRaw: unknown,
  sizeIdRaw: unknown,
  existing?: { typeId: number | null; sizeId: number | null },
): Promise<{ ok: true; value: ResolvedGrouping } | { ok: false; error: string }> {
  const typeParsed = nullableId(typeIdRaw);
  const sizeParsed = nullableId(sizeIdRaw);
  if (Number.isNaN(typeParsed)) return { ok: false, error: "Invalid typeId" };
  if (Number.isNaN(sizeParsed)) return { ok: false, error: "Invalid sizeId" };

  let typeId = typeParsed === undefined ? (existing?.typeId ?? null) : typeParsed;
  let sizeId = sizeParsed === undefined ? (existing?.sizeId ?? null) : sizeParsed;

  if (typeId == null) {
    if (sizeId != null) return { ok: false, error: "Choose a type before choosing a size" };
    return { ok: true, value: { typeId: null, sizeId: null, typeName: null, sizeName: null, lengthUnit: null } };
  }

  const [type] = await db.select({ id: inventoryPartTypesTable.id, name: inventoryPartTypesTable.name })
    .from(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.id, typeId), eq(inventoryPartTypesTable.tenantId, tenantId)));
  if (!type) return { ok: false, error: "Type not found" };

  if (sizeId != null && sizeParsed === undefined && typeParsed !== undefined) {
    const [current] = await db.select({ id: inventoryPartSizesTable.id })
      .from(inventoryPartSizesTable)
      .where(and(eq(inventoryPartSizesTable.id, sizeId), eq(inventoryPartSizesTable.tenantId, tenantId)));
    if (!current) sizeId = null;
  }

  if (sizeId == null) {
    return { ok: true, value: { typeId: type.id, sizeId: null, typeName: type.name, sizeName: null, lengthUnit: null } };
  }

  const [size] = await db.select({
    id: inventoryPartSizesTable.id,
    name: inventoryPartSizesTable.name,
    lengthUnit: inventoryPartSizesTable.lengthUnit,
  }).from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, sizeId), eq(inventoryPartSizesTable.tenantId, tenantId)));
  if (!size) return { ok: false, error: "Size not found" };
  return { ok: true, value: { typeId: type.id, sizeId: size.id, typeName: type.name, sizeName: size.name, lengthUnit: size.lengthUnit } };
}

async function partyNames(tenantId: number, item: { supplierId: number | null; vendorId: number | null }) {
  let supplierName: string | null = null;
  let vendorName: string | null = null;
  if (item.supplierId) {
    const [supplier] = await db.select({ name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable)
      .where(and(eq(inventorySuppliersTable.id, item.supplierId), eq(inventorySuppliersTable.tenantId, tenantId)));
    supplierName = supplier?.name ?? null;
  }
  if (item.vendorId) {
    const [vendor] = await db.select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(and(eq(vendorsTable.id, item.vendorId), eq(vendorsTable.tenantId, tenantId)));
    vendorName = vendor?.name ?? null;
  }
  return { supplierName, vendorName };
}

async function resolveVendor(tenantId: number, raw: unknown): Promise<{ ok: true; id: number | null; name: string | null } | { ok: false; error: string }> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, id: null, name: null };
  const id = parseSafeInt(raw, NaN);
  if (Number.isNaN(id)) return { ok: false, error: "Choose a vendor from the list" };
  const [vendor] = await db.select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, id), eq(vendorsTable.tenantId, tenantId)));
  if (!vendor) return { ok: false, error: "Vendor not found" };
  return { ok: true, id: vendor.id, name: vendor.name };
}

function readAmount(value: unknown, label: string): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  const parsed = parseOptionalAmount(value);
  if (parsed === "invalid") return { ok: false, error: `${label} must be a non-negative number` };
  return { ok: true, value: parsed };
}

async function groupingForItem(tenantId: number, typeId: number | null, sizeId: number | null) {
  const resolved = await resolveGrouping(tenantId, typeId, sizeId);
  return resolved.ok ? resolved.value : { typeId, sizeId, typeName: null, sizeName: null, lengthUnit: null };
}

// ─── routes ───────────────────────────────────────────────────────────────────

router.get("/inventory/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.tenantId, tenantId));

  const tenantMarkupPct = await getTenantMarkupPct(tenantId);
  const quantities = new Map(items.filter(item => item.stockItemId == null).map(item => [item.id, item.quantity]));
  const shown = items.map(item => withSharedQuantity(item, quantities.get(stockOwnerId(item))));
  const totalItems = items.length;
  // Value follows the one stored pile. A copy's quantity column stays 0, so stock is not counted twice.
  const totalValue = items.reduce((sum, i) => {
    if (i.stockItemId != null) return sum;
    return sum + resolveInventorySell({
      cost: i.unitPrice,
      pricePerFoot: i.pricePerFoot,
      markedUpPrice: i.markedUpPrice,
      defaultMarkupPct: tenantMarkupPct,
      itemMarkupPct: i.markupPct,
    }).sellPrice * i.quantity;
  }, 0);
  const lowStockCount = lowStockItems(shown).length;

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
  const { q, category, lowStock, availableForBlueprint, typeId: typeIdQuery, sizeId: sizeIdQuery } = req.query as Record<string, string>;

  let where = eq(inventoryItemsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (q) {
    where = and(where, or(
      ilike(inventoryItemsTable.name, `%${q}%`),
      ilike(inventoryItemsTable.sku, `%${q}%`),
      ilike(inventoryPartTypesTable.name, `%${q}%`),
      ilike(inventoryPartSizesTable.name, `%${q}%`),
    )) as typeof where;
  }
  if (category) where = and(where, eq(inventoryItemsTable.category, category)) as typeof where;
  if (typeIdQuery) {
    const typeId = parseSafeInt(typeIdQuery, NaN);
    if (Number.isNaN(typeId)) { res.status(400).json({ error: "Invalid typeId" }); return; }
    where = and(where, eq(inventoryItemsTable.typeId, typeId)) as typeof where;
  }
  if (sizeIdQuery) {
    const sizeId = parseSafeInt(sizeIdQuery, NaN);
    if (Number.isNaN(sizeId)) { res.status(400).json({ error: "Invalid sizeId" }); return; }
    where = and(where, eq(inventoryItemsTable.sizeId, sizeId)) as typeof where;
  }
  if (availableForBlueprint === "true") where = and(where, eq(inventoryItemsTable.availableForBlueprint, true)) as typeof where;

  const [items, markupPct, showCost, suppliers, vendors] = await Promise.all([
    db.select({
      item: inventoryItemsTable,
      typeName: inventoryPartTypesTable.name,
      sizeName: inventoryPartSizesTable.name,
      lengthUnit: inventoryPartSizesTable.lengthUnit,
    }).from(inventoryItemsTable)
      .leftJoin(inventoryPartTypesTable, eq(inventoryItemsTable.typeId, inventoryPartTypesTable.id))
      .leftJoin(inventoryPartSizesTable, eq(inventoryItemsTable.sizeId, inventoryPartSizesTable.id))
      .where(where)
      .orderBy(inventoryItemsTable.name),
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
    db.select({ id: inventorySuppliersTable.id, name: inventorySuppliersTable.name })
      .from(inventorySuppliersTable)
      .where(eq(inventorySuppliersTable.tenantId, tenantId)),
    db.select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.tenantId, tenantId)),
  ]);

  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  const vendorMap = new Map(vendors.map(vendor => [vendor.id, vendor.name]));
  const links = await linkedPartsByParent(tenantId, items.map(({ item }) => item.id));
  const quantities = await ownerQuantities(tenantId, items.map(({ item }) => item));
  const formatted = items.map(({ item, typeName, sizeName, lengthUnit }) => formatItem(
    withSharedQuantity(item, quantities.get(stockOwnerId(item))),
    markupPct,
    showCost,
    item.supplierId ? supplierMap.get(item.supplierId) : null,
    { typeName: typeName ?? null, sizeName: sizeName ?? null, lengthUnit: lengthUnit ?? null },
    item.vendorId ? vendorMap.get(item.vendorId) ?? null : null,
    links.get(item.id) ?? null,
  ));

  if (lowStock === "true") {
    res.json(formatted.filter(i => i.isLowStock));
    return;
  }
  res.json(formatted);
});

router.post("/inventory", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { name, sku, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit, availableForBlueprint, commissionPct: reqCommissionPct, supplierId: reqSupplierId, typeId: reqTypeId, sizeId: reqSizeId } = req.body;
  const stockAlerts = readStockAlerts(req.body?.stockAlerts);
  if (stockAlerts === "invalid") { res.status(400).json({ error: "stockAlerts must be true or false" }); return; }

  if (!name || !sku) {
    res.status(400).json({ error: "name and sku are required" });
    return;
  }

  const tenantMarkupPct = await getTenantMarkupPct(tenantId);
  const explicitMarkup = reqMarkupPct != null;
  const effectiveMarkupPct = explicitMarkup ? parseSafeFloat(reqMarkupPct, tenantMarkupPct) : tenantMarkupPct;
  const costVal = parseSafeFloat(costPrice, 0);
  if (costVal < 0) { res.status(400).json({ error: "costPrice must be >= 0" }); return; }
  if (effectiveMarkupPct < 0) { res.status(400).json({ error: "markupPct must be >= 0" }); return; }
  // A blank markup stays unmarked in storage so the company standard applies live.
  const markupSell = explicitMarkup ? priceWithMarkup(costVal, effectiveMarkupPct) : costVal;
  const lengthRead = readAmount(req.body.lengthReceived, "Length received");
  if (!lengthRead.ok) { res.status(400).json({ error: lengthRead.error }); return; }
  const priceRead = readAmount(req.body.pricePerFoot, "Price per foot");
  if (!priceRead.ok) { res.status(400).json({ error: priceRead.error }); return; }
  const vendor = req.body.vendorId !== undefined ? await resolveVendor(tenantId, req.body.vendorId) : { ok: true as const, id: null, name: null };
  if (!vendor.ok) { res.status(400).json({ error: vendor.error }); return; }
  const qtyInput = quantity == null || quantity === "" ? 0 : parseStockQuantity(quantity);
  if (qtyInput == null) { res.status(400).json({ error: "quantity must be a non-negative number" }); return; }
  const reorder = parseReorderPoint(reorderPoint, 5);
  if (reorder === "invalid") { res.status(400).json({ error: "Reorder point must be a whole number, 0 or greater" }); return; }
  const linkedBody = Object.prototype.hasOwnProperty.call(req.body, "linkedParts") ? req.body.linkedParts : undefined;
  if (linkedBody !== undefined) {
    const parsed = parseLinkedPartsBody(linkedBody);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  }
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

  const grouping = await resolveGrouping(tenantId, reqTypeId ?? null, reqSizeId ?? null);
  if (!grouping.ok) { res.status(400).json({ error: grouping.error }); return; }

  const arrival = applyArrival({
    quantity: qtyInput,
    unit: unit ? String(unit) : "each",
    sellPrice: markupSell,
    lengthReceived: lengthRead.value ?? null,
    pricePerFoot: priceRead.value ?? null,
    pipe: isPipeTypeName(grouping.value.typeName),
    markupPct: explicitMarkup ? effectiveMarkupPct : 0,
  });

  const [item] = await db.insert(inventoryItemsTable).values({
    tenantId,
    name: String(name),
    sku: String(sku),
    description: description ? String(description) : null,
    category: category ? String(category) : null,
    typeId: grouping.value.typeId,
    sizeId: grouping.value.sizeId,
    unitPrice: costVal,
    markedUpPrice: arrival.sellPrice,
    quantity: arrival.quantity,
    reorderPoint: reorder,
    unit: arrival.unit,
    stockAlerts: stockAlerts !== false,
    isLowStock: stockNeedsReorder(arrival.quantity, reorder, stockAlerts !== false),
    availableForBlueprint: availableForBlueprint === true || availableForBlueprint === "true",
    commissionPct: commissionPctVal,
    supplierId: resolvedSupplierId,
    lengthReceived: lengthRead.value ?? null,
    pricePerFoot: priceRead.value ?? null,
    vendorId: vendor.id,
    markupPct: explicitMarkup ? effectiveMarkupPct : null,
  }).returning();

  if (linkedBody !== undefined) {
    const saved = await saveLinkedPartsFromBody(tenantId, item.id, linkedBody);
    if (!saved.ok) { res.status(400).json({ error: saved.error }); return; }
  }
  const links = await linkedPartsByParent(tenantId, [item.id]);
  const showCost = await canSeeCostPrice(tenantId, userId);
  res.status(201).json(formatItem(item, tenantMarkupPct, showCost, supplierName, grouping.value, vendor.name, links.get(item.id) ?? null));
});

router.post("/inventory/duplicate", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids: number[] = rawIds.map(value => parseInt(String(value), 10));
  if (ids.length === 0 || ids.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    res.status(400).json({ error: "Choose at least one item" });
    return;
  }
  if (ids.length > 100) {
    res.status(400).json({ error: "Duplicate up to 100 items at a time" });
    return;
  }

  const uniqueIds = [...new Set(ids)];
  const [chosen, skuRows] = await Promise.all([
    db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), inArray(inventoryItemsTable.id, uniqueIds))),
    db.select({ sku: inventoryItemsTable.sku }).from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.tenantId, tenantId)),
  ]);
  if (chosen.length !== uniqueIds.length) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  const shareStock = req.body?.shareStock;
  if (shareStock !== undefined && typeof shareStock !== "boolean") {
    res.status(400).json({ error: "shareStock must be true or false" });
    return;
  }
  const planned = planDuplicates(chosen, ids, skuRows.map(row => row.sku), shareStock === true ? "shared" : "separate");
  if (!planned.ok) {
    res.status(400).json({ error: planned.error });
    return;
  }

  const inserted = await db.insert(inventoryItemsTable).values(
    planned.copies.map(copy => ({ tenantId, ...copy })),
  ).returning();

  const ownerIds = [...new Set(inserted.map(item => item.stockItemId).filter((id): id is number => id != null))];
  const owners = ownerIds.length === 0 ? [] : await db.select({ id: inventoryItemsTable.id, quantity: inventoryItemsTable.quantity })
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.tenantId, tenantId), inArray(inventoryItemsTable.id, ownerIds)));
  const quantities = new Map(owners.map(owner => [owner.id, owner.quantity]));
  const [markupPct, showCost] = await Promise.all([
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);

  const items = [];
  for (const item of inserted) {
    const names = await partyNames(tenantId, item);
    const grouping = await groupingForItem(tenantId, item.typeId, item.sizeId);
    items.push(formatItem(
      withSharedQuantity(item, quantities.get(stockOwnerId(item))),
      markupPct,
      showCost,
      names.supplierName,
      grouping,
      names.vendorName,
    ));
  }
  res.status(201).json({ items });
});

router.get("/inventory/:id", async (req, res, next): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  // Static paths such as /inventory/locations are mounted on a later router.
  if (isNaN(id)) { next(); return; }

  const [item, markupPct, showCost] = await Promise.all([
    db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)))
      .then(r => r[0]),
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const quantities = await ownerQuantities(tenantId, [item]);
  const names = await partyNames(tenantId, item);
  const grouping = await groupingForItem(tenantId, item.typeId, item.sizeId);
  const links = await linkedPartsByParent(tenantId, [item.id]);
  res.json(formatItem(
    withSharedQuantity(item, quantities.get(stockOwnerId(item))),
    markupPct,
    showCost,
    names.supplierName,
    grouping,
    names.vendorName,
    links.get(item.id) ?? null,
  ));
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
  if (req.body.markupPct !== undefined && req.body.markupPct !== null) {
    const m = parseSafeFloat(req.body.markupPct, NaN);
    if (isNaN(m) || m < 0) { res.status(400).json({ error: "markupPct must be a non-negative number" }); return; }
  }

  const { name, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit, availableForBlueprint, commissionPct: reqCommissionPct, supplierId: reqSupplierId, typeId: reqTypeId, sizeId: reqSizeId } = req.body;
  const stockAlerts = readStockAlerts(req.body?.stockAlerts);
  if (stockAlerts === "invalid") { res.status(400).json({ error: "stockAlerts must be true or false" }); return; }
  const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
  if (stockAlerts !== undefined) updates.stockAlerts = stockAlerts;
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (category !== undefined) updates.category = category ? String(category) : null;
  let sharedQuantity: number | undefined;
  if (req.body.sku !== undefined || quantity !== undefined) {
    const [current] = await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    if (req.body.sku !== undefined) {
      const sku = String(req.body.sku).trim();
      if (!sku) { res.status(400).json({ error: "sku is required" }); return; }
      // Create does not reject a repeated SKU. An item that already shares one can still
      // be edited as long as this save does not rename it onto yet another item.
      if (sku.toLowerCase() !== current.sku.trim().toLowerCase()) {
        const [clash] = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
          .where(and(
            eq(inventoryItemsTable.tenantId, tenantId),
            ne(inventoryItemsTable.id, id),
            sql`lower(${inventoryItemsTable.sku}) = lower(${sku})`,
          ));
        if (clash) { res.status(400).json({ error: "SKU is already in use" }); return; }
      }
      updates.sku = sku;
    }
    if (quantity !== undefined) {
      const nextQty = parseStockQuantity(quantity);
      if (nextQty == null) { res.status(400).json({ error: "quantity must be a non-negative number" }); return; }
      const ownerId = stockOwnerId(current);
      if (ownerId === current.id) {
        updates.quantity = nextQty;
      } else {
        await db.transaction(async tx => {
          await tx.execute(sql`SELECT set_config('inventory.keep_catalog_price', 'on', true)`);
          await tx.update(inventoryItemsTable).set({ quantity: nextQty })
            .where(and(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.tenantId, tenantId)));
        });
      }
      sharedQuantity = nextQty;
    }
  }
  if (reorderPoint !== undefined) {
    const reorder = parseReorderPoint(reorderPoint, 5);
    if (reorder === "invalid") { res.status(400).json({ error: "Reorder point must be a whole number, 0 or greater" }); return; }
    updates.reorderPoint = reorder;
  }
  const linkedBody = Object.prototype.hasOwnProperty.call(req.body, "linkedParts") ? req.body.linkedParts : undefined;
  if (linkedBody !== undefined) {
    const parsed = parseLinkedPartsBody(linkedBody);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    if (parsed.value?.components.some(component => component.inventoryItemId === id)) {
      res.status(400).json({ error: "A part cannot be linked to itself." });
      return;
    }
  }
  if (unit !== undefined) updates.unit = String(unit) || "each";
  if (availableForBlueprint !== undefined) updates.availableForBlueprint = availableForBlueprint === true || availableForBlueprint === "true";
  if (reqCommissionPct !== undefined) updates.commissionPct = reqCommissionPct != null ? parseSafeFloat(reqCommissionPct, 0) : null;

  if (reqTypeId !== undefined || reqSizeId !== undefined) {
    const [existingGrouping] = await db.select({ typeId: inventoryItemsTable.typeId, sizeId: inventoryItemsTable.sizeId })
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!existingGrouping) { res.status(404).json({ error: "Not found" }); return; }
    const grouping = await resolveGrouping(tenantId, reqTypeId, reqSizeId, existingGrouping);
    if (!grouping.ok) { res.status(400).json({ error: grouping.error }); return; }
    updates.typeId = grouping.value.typeId;
    updates.sizeId = grouping.value.sizeId;
  }

  if (reqSupplierId !== undefined) {
    if (reqSupplierId == null) {
      updates.supplierId = null;
    } else {
      const sid = parseSafeInt(reqSupplierId, NaN);
      if (isNaN(sid)) { res.status(400).json({ error: "Invalid supplierId" }); return; }
      const [sup] = await db.select({ id: inventorySuppliersTable.id })
        .from(inventorySuppliersTable)
        .where(and(eq(inventorySuppliersTable.id, sid), eq(inventorySuppliersTable.tenantId, tenantId)));
      if (!sup) { res.status(400).json({ error: "Supplier not found" }); return; }
      updates.supplierId = sup.id;
    }
  }

  const lengthRead = readAmount(req.body.lengthReceived, "Length received");
  if (!lengthRead.ok) { res.status(400).json({ error: lengthRead.error }); return; }
  if (lengthRead.value !== undefined) updates.lengthReceived = lengthRead.value;
  const priceRead = readAmount(req.body.pricePerFoot, "Price per foot");
  if (!priceRead.ok) { res.status(400).json({ error: priceRead.error }); return; }
  if (priceRead.value !== undefined) updates.pricePerFoot = priceRead.value;
  if (req.body.vendorId !== undefined) {
    const vendor = await resolveVendor(tenantId, req.body.vendorId);
    if (!vendor.ok) { res.status(400).json({ error: vendor.error }); return; }
    updates.vendorId = vendor.id;
  }

  if (costPrice !== undefined || reqMarkupPct !== undefined || updates.pricePerFoot !== undefined) {
    const [existing] = await db
      .select()
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const tenantDefault = await getTenantMarkupPct(tenantId);
    const nextPerFoot = updates.pricePerFoot !== undefined ? updates.pricePerFoot : existing.pricePerFoot;
    const priced = resolveInventorySell({
      cost: existing.unitPrice,
      pricePerFoot: nextPerFoot,
      markedUpPrice: existing.markedUpPrice,
      defaultMarkupPct: tenantDefault,
      itemMarkupPct: existing.markupPct,
    });
    const costVal = costPrice !== undefined ? parseSafeFloat(costPrice, existing.unitPrice) : existing.unitPrice;
    const clearToStandard = reqMarkupPct === null;
    const explicitMarkup = reqMarkupPct != null;
    const effectiveMarkupPct = clearToStandard ? tenantDefault : explicitMarkup ? parseSafeFloat(reqMarkupPct, priced.markupPct) : priced.markupPct;
    const storeStandard = clearToStandard || (!explicitMarkup && priced.usesDefaultMarkup);
    // 0 is an explicit markup. Null clears it so the company standard applies again.
    if (reqMarkupPct !== undefined) updates.markupPct = clearToStandard ? null : effectiveMarkupPct;
    if (nextPerFoot != null) {
      if (costPrice !== undefined || explicitMarkup || clearToStandard) updates.unitPrice = costVal;
      if (explicitMarkup) updates.markedUpPrice = priceWithMarkup(nextPerFoot, effectiveMarkupPct);
      else if (storeStandard) updates.markedUpPrice = nextPerFoot;
    } else if (costPrice !== undefined || explicitMarkup || clearToStandard || priced.usesDefaultMarkup) {
      if (costPrice !== undefined || explicitMarkup || clearToStandard) updates.unitPrice = costVal;
      if (explicitMarkup) updates.markedUpPrice = priceWithMarkup(costVal, effectiveMarkupPct);
      else if (storeStandard) updates.markedUpPrice = costVal;
      else if (costPrice !== undefined) updates.markedUpPrice = priceWithMarkup(costVal, effectiveMarkupPct);
    }
  }
  if ((updates.pricePerFoot != null || updates.lengthReceived != null) && (updates.unit === undefined || updates.unit === "each")) {
    updates.unit = "ft";
  }

  if (updates.quantity !== undefined || updates.reorderPoint !== undefined || updates.stockAlerts !== undefined) {
    const [existing] = await db
      .select({ quantity: inventoryItemsTable.quantity, reorderPoint: inventoryItemsTable.reorderPoint, stockAlerts: inventoryItemsTable.stockAlerts, stockItemId: inventoryItemsTable.stockItemId })
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    if (existing) {
      let qty = updates.quantity ?? existing.quantity;
      if (existing.stockItemId != null && updates.quantity === undefined) {
        const [owner] = await db.select({ quantity: inventoryItemsTable.quantity }).from(inventoryItemsTable)
          .where(and(eq(inventoryItemsTable.id, existing.stockItemId), eq(inventoryItemsTable.tenantId, tenantId)));
        if (owner) qty = owner.quantity;
      }
      const reorder = updates.reorderPoint ?? existing.reorderPoint;
      const alerts = updates.stockAlerts ?? existing.stockAlerts;
      updates.isLowStock = stockNeedsReorder(qty, reorder, alerts);
    }
  }

  let updated: typeof inventoryItemsTable.$inferSelect | undefined;
  if (Object.keys(updates).length === 0) {
    const [current] = await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
    updated = current;
  } else {
    const [row] = await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('inventory.keep_catalog_price', 'on', true)`);
      return tx.update(inventoryItemsTable)
        .set(updates)
        .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)))
        .returning();
    });
    updated = row;
  }
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (sharedQuantity !== undefined) await syncFamilyLowStock(tenantId, stockOwnerId(updated), sharedQuantity);

  const [markupPct, showCost] = await Promise.all([
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);

  if (linkedBody !== undefined) {
    const saved = await saveLinkedPartsFromBody(tenantId, updated.id, linkedBody);
    if (!saved.ok) { res.status(400).json({ error: saved.error }); return; }
  }
  const quantities = await ownerQuantities(tenantId, [updated]);
  const names = await partyNames(tenantId, updated);
  const grouping = await groupingForItem(tenantId, updated.typeId, updated.sizeId);
  const links = await linkedPartsByParent(tenantId, [updated.id]);
  res.json(formatItem(
    withSharedQuantity(updated, quantities.get(stockOwnerId(updated))),
    markupPct,
    showCost,
    names.supplierName,
    grouping,
    names.vendorName,
    links.get(updated.id) ?? null,
  ));
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
  const [existing] = await db.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const ownerId = stockOwnerId(existing);
  const [owner] = ownerId === existing.id
    ? [existing]
    : await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.tenantId, tenantId)));
  if (!owner) { res.status(404).json({ error: "Not found" }); return; }

  const planned = applyQuantityDelta(owner.quantity, delta);
  if (!planned.ok) {
    res.status(400).json({ error: planned.error });
    return;
  }

  const [updatedOwner] = await db.update(inventoryItemsTable)
    .set({ quantity: sql`${inventoryItemsTable.quantity}+${delta}`, isLowStock: sql`${inventoryItemsTable.stockAlerts} AND ${inventoryItemsTable.quantity}+${delta}<=${inventoryItemsTable.reorderPoint}` })
    .where(and(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.tenantId, tenantId), sql`${inventoryItemsTable.quantity}+${delta}>=0`))
    .returning();
  if (!updatedOwner) { res.status(409).json({ error: "Stock changed. Refresh the item and try again." }); return; }
  await syncFamilyLowStock(tenantId, ownerId, updatedOwner.quantity);

  const [markupPct, showCost] = await Promise.all([
    getTenantMarkupPct(tenantId),
    canSeeCostPrice(tenantId, userId),
  ]);
  const shown = withSharedQuantity(existing.id === ownerId ? updatedOwner : existing, updatedOwner.quantity);
  const names = await partyNames(tenantId, shown);
  const grouping = await groupingForItem(tenantId, shown.typeId, shown.sizeId);
  const links = await linkedPartsByParent(tenantId, [shown.id]);
  res.json(formatItem(shown, markupPct, showCost, names.supplierName, grouping, names.vendorName, links.get(shown.id) ?? null));
});

router.delete("/inventory/:id", requireInventoryMutate, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [copy] = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.stockItemId, id)))
    .limit(1);
  if (copy) {
    res.status(409).json({ error: "Delete the copies that share this stock first." });
    return;
  }
  await db
    .delete(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
