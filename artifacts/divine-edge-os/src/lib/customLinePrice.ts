/** Customer extended price. Custom pass-through lines are quantity × unit price. */
export function lineExtended(item: {
  kind?: string | null;
  qty?: number;
  quantity?: number;
  unitPrice?: number;
  markup?: number;
  discount?: number;
}): number {
  const qty = item.qty ?? item.quantity ?? 0;
  const price = item.unitPrice ?? 0;
  if (item.kind === "custom") return qty * price;
  return qty * price * (1 + (item.markup ?? 0) / 100) * (1 - (item.discount ?? 0) / 100);
}

export type LineSource = "service" | "part" | "custom";

export function lineSource(item: { kind?: string | null; inventoryItemId?: number | null }): LineSource {
  if (item.kind === "custom") return "custom";
  if (item.kind === "part" || item.inventoryItemId) return "part";
  return "service";
}

export function qtyWithUnit(qty: number, unit?: string | null): string {
  const label = unit?.trim();
  return label ? `${qty} ${label}` : String(qty);
}
