/**
 * A reorder point of 0 is a saved threshold: reorder when on hand is at or
 * below 0, which means only when the part is out of stock.
 * A blank value is missing and uses the fallback. It is not the same as 0.
 */
export function parseReorderPoint(value: unknown, fallback = 5): number | "invalid" {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const text = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return "invalid";
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) return "invalid";
  return n;
}

/**
 * Low stock when alerts are on and on hand is at or below the reorder point, including 0.
 * Alerts off keeps the item in inventory and out of low-stock and reorder alerts.
 */
export function stockNeedsReorder(onHand: number, reorderPoint: number, stockAlerts: boolean = true): boolean {
  if (stockAlerts === false) return false;
  return onHand <= reorderPoint;
}

export function readStockAlerts(value: unknown): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return "invalid";
}

/** Items that belong on the low-stock list. Alerts off stays off even at quantity 0. */
export function lowStockItems<T extends { quantity: number; reorderPoint: number; stockAlerts?: boolean | null }>(
  items: readonly T[],
): T[] {
  return items.filter(item => stockNeedsReorder(item.quantity, item.reorderPoint, item.stockAlerts !== false));
}
