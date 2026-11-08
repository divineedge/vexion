export interface InventoryLocationListItem {
  id: number;
  name: string;
}

/** Puts a saved location into the cached list immediately, in the same name order as the API. */
export function upsertInventoryLocation<T extends InventoryLocationListItem>(current: T[] | undefined, location: T): T[] {
  const list = current ?? [];
  const next = list.some(item => item.id === location.id)
    ? list.map(item => item.id === location.id ? location : item)
    : [...list, location];
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
