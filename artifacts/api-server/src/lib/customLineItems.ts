import { sql, type SQL } from "drizzle-orm";

/**
 * Custom / pass-through lines bill a description, quantity, and customer unit
 * price without a service catalog row or an inventory part. Existing line
 * objects are returned unchanged.
 */
export class LineItemError extends Error {
  status = 400;
}

type LineRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LineRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isCustomLine(item: unknown): item is LineRecord {
  return isRecord(item) && item.kind === "custom";
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function lineQuantity(item: { qty?: unknown; quantity?: unknown }): number {
  const number = finite(item.qty ?? item.quantity);
  return number ?? 0;
}

/** Customer extended price. Custom lines are quantity × unit price, with no markup or discount. */
export function lineExtendedPrice(item: {
  kind?: unknown;
  qty?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  markup?: unknown;
  discount?: unknown;
}): number {
  const qty = lineQuantity(item);
  const unitPrice = finite(item.unitPrice) ?? 0;
  const base = qty * unitPrice;
  if (item.kind === "custom") return base;
  const markup = finite(item.markup) ?? 0;
  const discount = finite(item.discount) ?? 0;
  return base * (1 + markup / 100) * (1 - discount / 100);
}

/** Deposit or full amount collected from an estimate total that already includes custom lines. */
export function acceptanceAmount(requirement: string | null | undefined, depositValue: number | null | undefined, total: number): number {
  if (!requirement || requirement === "none") return 0;
  if (requirement === "full") return total;
  if (requirement === "deposit_pct") return Math.round((depositValue ?? 0) / 100 * total * 100) / 100;
  if (requirement === "deposit_fixed") return depositValue ?? 0;
  return 0;
}

export function customLineEconomics(items: unknown): { sell: number; cost: number } {
  let sell = 0;
  let cost = 0;
  if (!Array.isArray(items)) return { sell, cost };
  for (const item of items) {
    if (!isCustomLine(item)) continue;
    const qty = lineQuantity(item);
    const price = finite(item.unitPrice);
    if (qty >= 0 && price !== null && price >= 0) sell += qty * price;
    const internal = finite(item.internalCost);
    if (qty >= 0 && internal !== null && internal >= 0) cost += qty * internal;
  }
  return { sell, cost };
}

export function customCostLines(items: unknown): { name: string; quantity: number; unitCost: number; cost: number; source: string }[] {
  if (!Array.isArray(items)) return [];
  const lines = [];
  for (const item of items) {
    if (!isCustomLine(item)) continue;
    const qty = lineQuantity(item);
    const internal = finite(item.internalCost);
    if (!(qty >= 0) || internal === null || internal < 0) continue;
    const cost = Math.round(qty * internal * 100) / 100;
    if (cost === 0) continue;
    lines.push({
      name: String(item.description ?? "Pass-through"),
      quantity: qty,
      unitCost: internal,
      cost,
      source: "Pass-through internal cost",
    });
  }
  return lines;
}

function optionalLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new LineItemError("Custom line unit label must be text");
  const label = value.trim();
  if (!label) return null;
  if (label.length > 40) throw new LineItemError("Custom line unit label must be 40 characters or less");
  return label;
}

function normalizeCustom(item: LineRecord, mode: "estimate" | "invoice"): LineRecord {
  const description = typeof item.description === "string" ? item.description.trim() : "";
  if (!description) throw new LineItemError("Custom line needs a description");
  if (description.length > 500) throw new LineItemError("Custom line description must be 500 characters or less");
  const qty = finite(item.qty ?? item.quantity);
  if (qty === null || qty <= 0) throw new LineItemError("Custom line quantity must be greater than zero");
  const unitPrice = finite(item.unitPrice);
  if (unitPrice === null || unitPrice < 0) throw new LineItemError("Custom line unit price must be zero or more");
  const internalRaw = item.internalCost;
  const internalCost = internalRaw === null || internalRaw === undefined || internalRaw === "" ? null : finite(internalRaw);
  if (internalCost === null && !(internalRaw === null || internalRaw === undefined || internalRaw === "")) {
    throw new LineItemError("Custom line internal cost must be a number");
  }
  if (internalCost !== null && internalCost < 0) throw new LineItemError("Custom line internal cost must be zero or more");
  const unit = optionalLabel(item.unit ?? item.unitLabel);
  const total = Math.round(qty * unitPrice * 100) / 100;
  return {
    ...item,
    kind: "custom",
    description,
    qty: mode === "estimate" ? qty : item.qty,
    quantity: qty,
    unitPrice,
    unit,
    unitLabel: undefined,
    internalCost,
    total,
    markup: 0,
    discount: 0,
    serviceId: null,
    serviceName: null,
    secondaryServiceId: null,
    secondaryServiceName: null,
    bundledServices: [],
    inventoryItemId: null,
    partId: null,
    sku: null,
    planTemplateId: null,
    planTemplateName: null,
    planBillingCycle: null,
    costPrice: null,
  };
}

/**
 * Rewrite only kind:"custom" lines. Service and part lines keep the same object.
 * Custom lines store null service and part ids and never reference inventory.
 */
export function prepareLineItems<T>(items: T[], mode: "estimate" | "invoice"): T[] {
  if (!Array.isArray(items)) throw new LineItemError("Line items must be a list");
  return items.map(item => {
    if (!isCustomLine(item)) return item;
    return normalizeCustom(item, mode) as T;
  });
}

/** SQL sum of custom-line sell or internal cost. Other line kinds contribute nothing. */
export function customLineSum(document: SQL, mode: "sell" | "cost"): SQL {
  const amount = mode === "sell"
    ? sql`(COALESCE(NULLIF(elem->>'quantity',''), elem->>'qty'))::numeric * (elem->>'unitPrice')::numeric`
    : sql`(COALESCE(NULLIF(elem->>'quantity',''), elem->>'qty'))::numeric * (elem->>'internalCost')::numeric`;
  const costGuard = mode === "cost"
    ? sql`AND (elem->>'internalCost') ~ '^[0-9]+(\\.[0-9]+)?$'`
    : sql``;
  return sql`COALESCE((SELECT SUM(CASE WHEN elem->>'kind' = 'custom'
      AND COALESCE(NULLIF(elem->>'quantity',''), elem->>'qty') ~ '^[0-9]+(\\.[0-9]+)?$'
      AND (elem->>'unitPrice') ~ '^[0-9]+(\\.[0-9]+)?$'
      ${costGuard}
    THEN ${amount} ELSE 0 END)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${document}) = 'array' THEN ${document} ELSE '[]'::jsonb END) elem), 0)`;
}
