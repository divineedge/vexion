import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, inventoryItemsTable, inventoryPartSizesTable, inventoryPartTypesTable, inventorySuppliersTable, tenantsTable, vendorsTable } from "@workspace/db";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { applyArrival, isPipeTypeName, parseOptionalAmount, sellUnitPrice } from "../lib/pipeStock";
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
    if (query.q) where = and(where, or(ilike(inventoryItemsTable.name, `%${query.q}%`),ilike(inventoryItemsTable.sku, `%${query.q}%`))) as typeof where;
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
  grouping?: { typeName: string | null; sizeName: string | null },
  vendorName?: string | null,
) {
  const costPrice = i.unitPrice;     // DB unitPrice = what we pay
  const sellPrice = sellUnitPrice(i.pricePerFoot, i.markedUpPrice);
  const markup = storedMarkupPct(costPrice, sellPrice, tenantMarkupPct);
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
    pricePerFoot: i.pricePerFoot ?? null,
    vendorId: i.vendorId ?? null,
    vendorName: resolvedVendor,
    costPrice: includeCostPrice ? costPrice : null,
    unitPrice: sellPrice,
    markupPct: markup,
    markedUpPrice: sellPrice,
    quantity: i.quantity,
    reorderPoint: i.reorderPoint,
    unit: i.pricePerFoot != null && (!i.unit || i.unit === "each") ? "ft" : i.unit,
    isLowStock: i.quantity <= i.reorderPoint,
    availableForBlueprint: i.availableForBlueprint,
    commissionPct: i.commissionPct ?? null,
    supplierId: i.supplierId ?? null,
    supplierName: resolvedVendor ?? supplierName ?? null,
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

type ResolvedGrouping = {
  typeId: number | null;
  sizeId: number | null;
  typeName: string | null;
  sizeName: string | null;
};

function nullableId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseSafeInt(value, NaN);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Resolve a part's type and the size under that type. Both may be empty. */
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
    return { ok: true, value: { typeId: null, sizeId: null, typeName: null, sizeName: null } };
  }

  const [type] = await db.select({ id: inventoryPartTypesTable.id, name: inventoryPartTypesTable.name })
    .from(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.id, typeId), eq(inventoryPartTypesTable.tenantId, tenantId)));
  if (!type) return { ok: false, error: "Type not found" };

  if (sizeId != null && sizeParsed === undefined && typeParsed !== undefined) {
    const [current] = await db.select({ typeId: inventoryPartSizesTable.typeId })
      .from(inventoryPartSizesTable)
      .where(and(eq(inventoryPartSizesTable.id, sizeId), eq(inventoryPartSizesTable.tenantId, tenantId)));
    if (!current || current.typeId !== type.id) sizeId = null;
  }

  if (sizeId == null) {
    return { ok: true, value: { typeId: type.id, sizeId: null, typeName: type.name, sizeName: null } };
  }

  const [size] = await db.select({
    id: inventoryPartSizesTable.id,
    name: inventoryPartSizesTable.name,
    typeId: inventoryPartSizesTable.typeId,
  }).from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, sizeId), eq(inventoryPartSizesTable.tenantId, tenantId)));
  if (!size || size.typeId !== type.id) return { ok: false, error: "Size does not belong to the selected type" };
  return { ok: true, value: { typeId: type.id, sizeId: size.id, typeName: type.name, sizeName: size.name } };
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
  return resolved.ok ? resolved.value : { typeId, sizeId, typeName: null, sizeName: null };
}

// ─── routes ───────────────────────────────────────────────────────────────────

router.get("/inventory/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.tenantId, tenantId));

  const totalItems = items.length;
  const totalValue = items.reduce((sum, i) => sum + sellUnitPrice(i.pricePerFoot, i.markedUpPrice) * i.quantity, 0);
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
  const formatted = items.map(({ item, typeName, sizeName }) => formatItem(
    item,
    markupPct,
    showCost,
    item.supplierId ? supplierMap.get(item.supplierId) : null,
    { typeName: typeName ?? null, sizeName: sizeName ?? null },
    item.vendorId ? vendorMap.get(item.vendorId) ?? null : null,
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

  if (!name || !sku) {
    res.status(400).json({ error: "name and sku are required" });
    return;
  }

  const tenantMarkupPct = await getTenantMarkupPct(tenantId);
  const effectiveMarkupPct = reqMarkupPct != null ? parseSafeFloat(reqMarkupPct, tenantMarkupPct) : tenantMarkupPct;
  const costVal = parseSafeFloat(costPrice, 0);
  if (costVal < 0) { res.status(400).json({ error: "costPrice must be >= 0" }); return; }
  if (effectiveMarkupPct < 0) { res.status(400).json({ error: "markupPct must be >= 0" }); return; }
  const markupSell = costVal * (1 + effectiveMarkupPct / 100);
  const lengthRead = readAmount(req.body.lengthReceived, "Length received");
  if (!lengthRead.ok) { res.status(400).json({ error: lengthRead.error }); return; }
  const priceRead = readAmount(req.body.pricePerFoot, "Price per foot");
  if (!priceRead.ok) { res.status(400).json({ error: priceRead.error }); return; }
  const vendor = req.body.vendorId !== undefined ? await resolveVendor(tenantId, req.body.vendorId) : { ok: true as const, id: null, name: null };
  if (!vendor.ok) { res.status(400).json({ error: vendor.error }); return; }
  const qtyInput = parseSafeInt(quantity, 0);
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

  const grouping = await resolveGrouping(tenantId, reqTypeId ?? null, reqSizeId ?? null);
  if (!grouping.ok) { res.status(400).json({ error: grouping.error }); return; }

  const arrival = applyArrival({
    quantity: qtyInput,
    unit: unit ? String(unit) : "each",
    sellPrice: markupSell,
    lengthReceived: lengthRead.value ?? null,
    pricePerFoot: priceRead.value ?? null,
    pipe: isPipeTypeName(grouping.value.typeName),
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
    isLowStock: arrival.quantity <= reorder,
    availableForBlueprint: availableForBlueprint === true || availableForBlueprint === "true",
    commissionPct: commissionPctVal,
    supplierId: resolvedSupplierId,
    lengthReceived: lengthRead.value ?? null,
    pricePerFoot: priceRead.value ?? null,
    vendorId: vendor.id,
  }).returning();

  const showCost = await canSeeCostPrice(tenantId, userId);
  res.status(201).json(formatItem(item, tenantMarkupPct, showCost, supplierName, grouping.value, vendor.name));
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

  const names = await partyNames(tenantId, item);
  const grouping = await groupingForItem(tenantId, item.typeId, item.sizeId);
  res.json(formatItem(item, markupPct, showCost, names.supplierName, grouping, names.vendorName));
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

  const { name, description, category, costPrice, markupPct: reqMarkupPct, quantity, reorderPoint, unit, availableForBlueprint, commissionPct: reqCommissionPct, supplierId: reqSupplierId, typeId: reqTypeId, sizeId: reqSizeId } = req.body;
  const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (category !== undefined) updates.category = category ? String(category) : null;
  if (quantity !== undefined) { updates.quantity = parseSafeInt(quantity, 0); }
  if (reorderPoint !== undefined) { updates.reorderPoint = parseSafeInt(reorderPoint, 5); }
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
  if (updates.pricePerFoot != null) updates.markedUpPrice = updates.pricePerFoot;
  if ((updates.pricePerFoot != null || updates.lengthReceived != null) && (updates.unit === undefined || updates.unit === "each")) {
    updates.unit = "ft";
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

  const names = await partyNames(tenantId, updated);
  const grouping = await groupingForItem(tenantId, updated.typeId, updated.sizeId);
  res.json(formatItem(updated, markupPct, showCost, names.supplierName, grouping, names.vendorName));
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
  const names = await partyNames(tenantId, updated);
  const grouping = await groupingForItem(tenantId, updated.typeId, updated.sizeId);
  res.json(formatItem(updated, markupPct, showCost, names.supplierName, grouping, names.vendorName));
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
