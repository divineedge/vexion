import { and, eq, sql } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryPartSizesTable, inventoryPartTypesTable, vendorsTable } from "@workspace/db";
import { applyArrival, isPipeTypeName } from "./pipeStock";
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  type ImportFieldMeta,
  type ParsedRow,
  type RowParseResult,
} from "./importExport";

/** Marks values produced by the inventory CSV parser so rollback snapshots stay raw columns. */
export const INVENTORY_IMPORT_FLAG = "__inventoryImport";

export const inventoryImportFields: ImportFieldMeta[] = [
  { key: "name", header: "Name", required: true },
  { key: "sku", header: "SKU", required: true, hint: "Used to match an existing item" },
  { key: "typeName", header: "Type", hint: "Created when this name is new" },
  { key: "sizeName", header: "Size", hint: "Shared across every type and category. Created when this name is new" },
  { key: "category", header: "Category" },
  { key: "quantity", header: "Quantity" },
  { key: "unitPrice", header: "Cost", hint: "Buy price" },
  { key: "markedUpPrice", header: "Sell Price" },
  { key: "supplierName", header: "Supplier", hint: "Matched to an existing vendor by name" },
  { key: "lengthReceived", header: "Pipe Feet", hint: "Feet received, when the file includes them" },
  { key: "pricePerFoot", header: "Price Per Foot", hint: "Per-foot sell price, when the file includes it" },
  { key: "description", header: "Description" },
  { key: "reorderPoint", header: "Reorder Point" },
  { key: "unit", header: "Unit" },
  { key: "availableForBlueprint", header: "Blueprint Ready" },
];

type ItemWrite = Partial<typeof inventoryItemsTable.$inferInsert>;

function putNumber(raw: ParsedRow, key: string, label: string, errors: string[], values: Record<string, unknown>, integer = false) {
  const text = raw[key] ?? "";
  if (!text.trim()) return;
  const parsed = optionalNumber(text, label, errors);
  if (parsed === undefined) return;
  if (parsed < 0) {
    errors.push(`${label} must be a non-negative number`);
    return;
  }
  values[key] = integer ? Math.round(parsed) : parsed;
}

/**
 * Turns one mapped CSV row into item values.
 * Blank cells are left out so unmapped and empty columns are skipped.
 */
export function parseInventoryImportRow(raw: ParsedRow): RowParseResult {
  const errors: string[] = [];
  const name = requireString(raw.name ?? "", "Name", errors);
  const sku = requireString(raw.sku ?? "", "SKU", errors);
  if (errors.length > 0 || !name || !sku) return { ok: false, errors };

  const values: Record<string, unknown> = {
    [INVENTORY_IMPORT_FLAG]: true,
    name,
    sku,
  };

  for (const key of ["description", "category", "typeName", "sizeName", "supplierName", "unit"] as const) {
    const value = optionalString(raw[key] ?? "");
    if (value !== undefined) values[key] = value;
  }

  putNumber(raw, "unitPrice", "Cost", errors, values);
  putNumber(raw, "markedUpPrice", "Sell Price", errors, values);
  putNumber(raw, "quantity", "Quantity", errors, values, true);
  putNumber(raw, "reorderPoint", "Reorder Point", errors, values, true);
  putNumber(raw, "lengthReceived", "Pipe Feet", errors, values);
  putNumber(raw, "pricePerFoot", "Price Per Foot", errors, values);

  const blueprint = optionalBoolean(raw.availableForBlueprint ?? "");
  if (blueprint !== undefined) values.availableForBlueprint = blueprint;

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values };
}

async function findType(tenantId: number, name: string) {
  const [row] = await db.select({ id: inventoryPartTypesTable.id, name: inventoryPartTypesTable.name })
    .from(inventoryPartTypesTable)
    .where(and(
      eq(inventoryPartTypesTable.tenantId, tenantId),
      sql`lower(${inventoryPartTypesTable.name}) = ${name.toLowerCase()}`,
    ))
    .limit(1);
  return row ?? null;
}

async function ensureType(tenantId: number, name: string) {
  const existing = await findType(tenantId, name);
  if (existing) return existing;
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryPartTypesTable)
    .where(eq(inventoryPartTypesTable.tenantId, tenantId));
  const [created] = await db.insert(inventoryPartTypesTable).values({
    tenantId,
    name,
    sortOrder: count?.n ?? 0,
  }).returning({ id: inventoryPartTypesTable.id, name: inventoryPartTypesTable.name });
  return created;
}

/** A size name is one catalog entry, reusable on any type. */
async function findSharedSize(tenantId: number, name: string) {
  const [row] = await db.select({ id: inventoryPartSizesTable.id, name: inventoryPartSizesTable.name })
    .from(inventoryPartSizesTable)
    .where(and(
      eq(inventoryPartSizesTable.tenantId, tenantId),
      sql`lower(${inventoryPartSizesTable.name}) = ${name.toLowerCase()}`,
    ))
    .limit(1);
  return row ?? null;
}

async function ensureSharedSize(tenantId: number, name: string, typeId: number | null) {
  const existing = await findSharedSize(tenantId, name);
  if (existing) return existing;
  if (typeId == null) throw new Error("A new size needs a type on the same row");
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryPartSizesTable)
    .where(eq(inventoryPartSizesTable.typeId, typeId));
  const [created] = await db.insert(inventoryPartSizesTable).values({
    tenantId,
    typeId,
    name,
    sortOrder: count?.n ?? 0,
  }).returning({ id: inventoryPartSizesTable.id, name: inventoryPartSizesTable.name });
  return created;
}

async function matchSupplier(tenantId: number, name: string) {
  const [vendor] = await db.select({ id: vendorsTable.id }).from(vendorsTable)
    .where(and(
      eq(vendorsTable.tenantId, tenantId),
      sql`lower(${vendorsTable.name}) = ${name.toLowerCase()}`,
    ))
    .limit(1);
  if (!vendor) throw new Error(`Supplier "${name}" was not found in the vendor list`);
  return vendor.id;
}

function textValue(values: Record<string, unknown>, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(values: Record<string, unknown>, key: string): number | undefined {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolves type, shared size, and supplier names into columns.
 * Rollback snapshots already store column values and are returned unchanged.
 */
export async function inventoryRecordFromImport(
  tenantId: number,
  values: Record<string, unknown>,
  mode: "insert" | "update",
): Promise<ItemWrite> {
  if (values[INVENTORY_IMPORT_FLAG] !== true) {
    const copy: Record<string, unknown> = { ...values };
    delete copy[INVENTORY_IMPORT_FLAG];
    return copy as ItemWrite;
  }

  const columns: ItemWrite = { name: String(values.name), sku: String(values.sku) };
  if (textValue(values, "description") !== undefined) columns.description = textValue(values, "description") ?? null;
  if (textValue(values, "category") !== undefined) columns.category = textValue(values, "category") ?? null;
  if (typeof values.availableForBlueprint === "boolean") columns.availableForBlueprint = values.availableForBlueprint;
  if (numberValue(values, "reorderPoint") !== undefined) columns.reorderPoint = numberValue(values, "reorderPoint");

  let typeName: string | null = null;
  const requestedType = textValue(values, "typeName");
  if (requestedType) {
    const type = await ensureType(tenantId, requestedType);
    columns.typeId = type.id;
    typeName = type.name;
  }

  const requestedSize = textValue(values, "sizeName");
  if (requestedSize) {
    const size = await ensureSharedSize(tenantId, requestedSize, columns.typeId ?? null);
    columns.sizeId = size.id;
  }

  const supplier = textValue(values, "supplierName");
  if (supplier) columns.vendorId = await matchSupplier(tenantId, supplier);

  const lengthReceived = numberValue(values, "lengthReceived") ?? null;
  const pricePerFoot = numberValue(values, "pricePerFoot") ?? null;
  const quantity = numberValue(values, "quantity");
  const cost = numberValue(values, "unitPrice");
  const sell = numberValue(values, "markedUpPrice");
  const unit = textValue(values, "unit");

  if (mode === "insert") {
    const arrival = applyArrival({
      quantity: quantity ?? 0,
      unit: unit ?? "each",
      sellPrice: sell ?? cost ?? 0,
      lengthReceived,
      pricePerFoot,
      pipe: isPipeTypeName(typeName),
    });
    columns.unitPrice = cost ?? 0;
    columns.markedUpPrice = arrival.sellPrice;
    columns.quantity = arrival.quantity;
    columns.reorderPoint = columns.reorderPoint ?? 5;
    columns.unit = arrival.unit;
    columns.isLowStock = arrival.quantity <= (columns.reorderPoint ?? 5);
    if (lengthReceived != null) columns.lengthReceived = lengthReceived;
    if (pricePerFoot != null) columns.pricePerFoot = pricePerFoot;
    return columns;
  }

  if (cost !== undefined) columns.unitPrice = cost;
  if (sell !== undefined) columns.markedUpPrice = sell;
  if (quantity !== undefined) columns.quantity = quantity;
  if (unit !== undefined) columns.unit = unit;
  if (lengthReceived != null) columns.lengthReceived = lengthReceived;
  if (pricePerFoot != null) {
    columns.pricePerFoot = pricePerFoot;
    if (sell === undefined) columns.markedUpPrice = pricePerFoot;
  }
  if ((lengthReceived != null || pricePerFoot != null) && columns.unit === undefined) columns.unit = "ft";
  return columns;
}
