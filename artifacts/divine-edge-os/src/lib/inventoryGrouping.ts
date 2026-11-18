/** How the inventory list is sectioned. Persisted on the tenant. */
export type InventoryGroupBy = "type" | "size";

export type InventorySizeOption = {
  id: number;
  typeId: number;
  name: string;
};

export type GroupableInventoryItem = {
  id: number;
  name: string;
  typeId?: number | null;
  typeName?: string | null;
  sizeId?: number | null;
  sizeName?: string | null;
};

export type InventoryGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

export const NO_TYPE_LABEL = "No type";
export const NO_SIZE_LABEL = "No size";

/** Sizes offered once a type is chosen. No type means no sizes. */
export function sizesForType<T extends { typeId: number }>(sizes: readonly T[], typeId: number | null): T[] {
  if (typeId == null) return [];
  return sizes.filter(size => size.typeId === typeId);
}

/** Keep a size only when it belongs to the chosen type. */
export function sizeIdForType(
  sizeId: number | null,
  typeId: number | null,
  sizes: readonly { id: number; typeId: number }[],
): number | null {
  if (typeId == null || sizeId == null) return null;
  return sizes.some(size => size.id === sizeId && size.typeId === typeId) ? sizeId : null;
}

function sizeGroupLabel(item: GroupableInventoryItem): string {
  const size = item.sizeName?.trim() || `Size ${item.sizeId}`;
  const type = item.typeName?.trim();
  return type ? `${size} · ${type}` : size;
}

/**
 * Section the inventory list by type or by size.
 * Parts with no type or size stay in a trailing group so they remain visible.
 */
export function groupInventoryItems<T extends GroupableInventoryItem>(
  items: readonly T[],
  groupBy: InventoryGroupBy,
): InventoryGroup<T>[] {
  const groups = new Map<string, InventoryGroup<T>>();
  for (const item of items) {
    const unassigned = groupBy === "type" ? item.typeId == null : item.sizeId == null;
    const key = unassigned
      ? "unassigned"
      : groupBy === "type"
        ? `type:${item.typeId}`
        : `size:${item.sizeId}`;
    const label = unassigned
      ? (groupBy === "type" ? NO_TYPE_LABEL : NO_SIZE_LABEL)
      : groupBy === "type"
        ? (item.typeName?.trim() || `Type ${item.typeId}`)
        : sizeGroupLabel(item);
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, label, items: [item] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "unassigned") return 1;
    if (b.key === "unassigned") return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  });
}
