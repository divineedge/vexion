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

/** Low stock when on hand is at or below the reorder point, including 0. */
export function stockNeedsReorder(onHand: number, reorderPoint: number): boolean {
  return onHand <= reorderPoint;
}
