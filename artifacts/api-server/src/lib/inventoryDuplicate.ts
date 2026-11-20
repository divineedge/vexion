/** Catalog row that can be copied without opening a second stock pile. */
export type DuplicableItem = {
  id: number;
  stockItemId: number | null;
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  typeId: number | null;
  sizeId: number | null;
  unitPrice: number;
  markedUpPrice: number;
  markupPct?: number | null;
  quantity: number;
  reorderPoint: number;
  unit: string;
  stockAlerts?: boolean;
  availableForBlueprint: boolean;
  commissionPct: number | null;
  supplierId: number | null;
  lengthReceived: number | null;
  pricePerFoot: number | null;
  vendorId: number | null;
};

export type DuplicateMode = "separate" | "shared";

export type DuplicateInsert = {
  stockItemId: number | null;
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  typeId: number | null;
  sizeId: number | null;
  unitPrice: number;
  markedUpPrice: number;
  markupPct: number | null;
  quantity: 0;
  reorderPoint: number;
  unit: string;
  stockAlerts: boolean;
  isLowStock: boolean;
  availableForBlueprint: boolean;
  commissionPct: number | null;
  supplierId: number | null;
  lengthReceived: number | null;
  pricePerFoot: number | null;
  vendorId: number | null;
};

/** The item that owns the single on-hand pile. A copy points at that item, never at another copy. */
export function stockOwnerId(item: { id: number; stockItemId?: number | null }): number {
  return item.stockItemId ?? item.id;
}

/** Quantity shown for a row. Copies read the owner's pile and do not keep their own. */
export function presentQuantity(item: { quantity: number; stockItemId: number | null }, ownerQuantity: number | undefined): number {
  if (item.stockItemId == null) return item.quantity;
  return ownerQuantity ?? 0;
}

export function withSharedQuantity<T extends { quantity: number; stockItemId: number | null }>(
  item: T,
  ownerQuantity: number | undefined,
): T {
  const quantity = presentQuantity(item, ownerQuantity);
  return quantity === item.quantity ? item : { ...item, quantity };
}

export function applyQuantityDelta(
  quantity: number,
  delta: number,
): { ok: true; quantity: number } | { ok: false; error: string } {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, error: "delta must be a non-zero integer" };
  }
  const next = quantity + delta;
  if (next < 0) return { ok: false, error: "Stock adjustment would result in negative quantity" };
  return { ok: true, quantity: next };
}

/** A SKU the user can edit later. It does not collide with any SKU already taken, including earlier copies in the same batch. */
export function uniqueCopySku(sku: string, taken: Set<string>): string {
  const base = (sku.trim() || "ITEM").replace(/\s+/g, "-");
  let candidate = `${base}-COPY`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-COPY-${n}`;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export function planDuplicates(
  sources: readonly DuplicableItem[],
  ids: readonly number[],
  takenSkus: Iterable<string>,
  mode: DuplicateMode = "separate",
): { ok: true; copies: DuplicateInsert[] } | { ok: false; error: string } {
  if (ids.length === 0) return { ok: false, error: "Choose at least one item" };
  const shareStock = mode === "shared";
  const byId = new Map(sources.map(item => [item.id, item]));
  const taken = new Set([...takenSkus].map(sku => sku.trim().toLowerCase()).filter(Boolean));
  const copies: DuplicateInsert[] = [];
  for (const id of ids) {
    const source = byId.get(id);
    if (!source) return { ok: false, error: "Inventory item not found" };
    copies.push({
      stockItemId: shareStock ? stockOwnerId(source) : null,
      name: `${source.name} copy`,
      sku: uniqueCopySku(source.sku, taken),
      description: source.description,
      category: source.category,
      typeId: source.typeId,
      sizeId: source.sizeId,
      unitPrice: source.unitPrice,
      markedUpPrice: source.markedUpPrice,
      markupPct: source.markupPct ?? null,
      quantity: 0,
      reorderPoint: source.reorderPoint,
      unit: source.unit,
      stockAlerts: source.stockAlerts !== false,
      isLowStock: source.stockAlerts === false ? false : (shareStock ? false : source.reorderPoint >= 0),
      availableForBlueprint: source.availableForBlueprint,
      commissionPct: source.commissionPct,
      supplierId: source.supplierId,
      lengthReceived: source.lengthReceived,
      pricePerFoot: source.pricePerFoot,
      vendorId: source.vendorId,
    });
  }
  return { ok: true, copies };
}
