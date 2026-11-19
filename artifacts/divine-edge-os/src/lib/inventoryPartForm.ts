/** A type such as Pipe or PVC Pipe is sold by the foot. */
export function isPipeTypeName(name: string | null | undefined): boolean {
  return /\bpipe\b/i.test(name ?? "");
}

/** Existing category strings, drafts typed on this form, and the current value. */
export function categoryChoices(
  stored: readonly string[],
  drafts: readonly string[],
  current: string,
): string[] {
  const seen = new Map<string, string>();
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  };
  for (const value of stored) {
    for (const part of value.split(",")) add(part);
  }
  for (const draft of drafts) add(draft);
  add(current);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function namedId(items: readonly { id: number; name: string }[], name: string): number | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return items.find(item => item.name.trim().toLowerCase() === key)?.id ?? null;
}

/** Gallons, ounces, and pounds are chemical stock sizes. Other sizes, including pipe, stay as they are. */
export function unitForChemicalSize(name: string | null | undefined): "gal" | "oz" | "lb" | null {
  const key = (name ?? "").trim().toLowerCase();
  if (key === "gal" || key === "gallon" || key === "gallons") return "gal";
  if (key === "oz" || key === "ounce" || key === "ounces" || key === "fl oz" || key === "fluid ounces") return "oz";
  if (key === "lb" || key === "lbs" || key === "pound" || key === "pounds") return "lb";
  return null;
}

export function formatInventoryQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

/** Every saved size, in name order. The menu does not depend on the selected type. */
export function inventorySizeOptions(sizes: readonly { id: number; name: string }[]): { value: string; label: string }[] {
  return [...sizes]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id - b.id)
    .map(size => ({ value: String(size.id), label: size.name }));
}

/** Keep a selected size when the type changes, as long as that size still exists. */
export function sizeIdAcrossTypes(sizeId: string, sizes: readonly { id: number }[]): string {
  if (!sizeId) return "";
  return sizes.some(size => String(size.id) === sizeId) ? sizeId : "";
}

export function feetFromLength(length: number): number {
  if (!Number.isFinite(length) || length < 0) return 0;
  return Math.max(0, Math.round(length));
}

/** Same sell-price formula a normal part uses on its buy price: base × (1 + markup% / 100). */
export function priceWithMarkup(base: number, markupPct: number): number {
  const markup = Number.isFinite(markupPct) ? markupPct : 0;
  return base * (1 + markup / 100);
}

/** Sell price per foot shown on the inventory form. A blank markup uses the company default. */
export function pipeSellPerFoot(pricePerFoot: string, markupPct: string, defaultMarkupPct: number): number | null {
  if (pricePerFoot.trim() === "") return null;
  const base = Number(pricePerFoot);
  const markup = parseFloat(markupPct || String(defaultMarkupPct));
  if (!Number.isFinite(base) || !Number.isFinite(markup)) return null;
  return priceWithMarkup(base, markup);
}

function moneyNear(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Prices for one row of the all-inventory list.
 * A sell figure that is still the buy price, or a pipe sell figure that is still
 * the raw per-foot price, has no item markup. Those rows use the company standard.
 * Pipe sell price is the per-foot price times one plus that markup. Another part
 * keeps its stored sell price when it already has its own markup.
 */
export function inventoryListFigures(input: {
  costPrice?: number | null;
  pricePerFoot?: number | null;
  unitPrice: number;
  markupPct?: number | null;
  defaultMarkupPct: number;
}): { pricePerFoot: number | null; markupPct: number; sellPrice: number } {
  const pricePerFoot = input.pricePerFoot != null && Number.isFinite(input.pricePerFoot) ? input.pricePerFoot : null;
  const cost = input.costPrice != null && Number.isFinite(input.costPrice) ? input.costPrice : null;
  const storedSell = Number.isFinite(input.unitPrice) ? input.unitPrice : 0;
  const standard = Number.isFinite(input.defaultMarkupPct) ? input.defaultMarkupPct : 0;
  if (pricePerFoot == null && cost === 0) {
    return { pricePerFoot: null, markupPct: standard, sellPrice: roundMoney(storedSell) };
  }
  const unmarked = pricePerFoot != null
    ? moneyNear(storedSell, pricePerFoot) || (cost != null && moneyNear(storedSell, cost) && !moneyNear(cost, pricePerFoot))
    : cost != null && moneyNear(storedSell, cost);
  const markup = !unmarked && input.markupPct != null && Number.isFinite(input.markupPct)
    ? input.markupPct
    : standard;
  if (pricePerFoot != null) {
    return { pricePerFoot, markupPct: markup, sellPrice: roundMoney(priceWithMarkup(pricePerFoot, markup)) };
  }
  if (unmarked && cost != null) {
    return { pricePerFoot: null, markupPct: markup, sellPrice: roundMoney(priceWithMarkup(cost, markup)) };
  }
  return { pricePerFoot: null, markupPct: markup, sellPrice: roundMoney(storedSell) };
}

/**
 * A reorder point of 0 is saved. Reorder when on hand is at or below it,
 * which means only when the part is out of stock. A blank value is missing.
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

export function stockNeedsReorder(onHand: number, reorderPoint: number): boolean {
  return onHand <= reorderPoint;
}

/** 100 of the parent with 10 of a component means 50 uses 5 and 200 uses 20. */
export function scaledComponentQuantity(parentRatio: number, used: number, componentRatio: number): number {
  if (!(parentRatio > 0) || !(used > 0) || !(componentRatio > 0)) return 0;
  return Math.round(componentRatio * (used / parentRatio) * 1_000_000) / 1_000_000;
}

export type LinkedPartDraft = {
  inventoryItemId: number | null;
  quantity: string;
};

export function parseLinkedPartsDraft(
  parentQuantity: string,
  links: readonly LinkedPartDraft[],
): { ok: true; value: { quantity: number; components: { inventoryItemId: number; quantity: number }[] } | null } | { ok: false; error: string } {
  const filled = links.filter(link => link.inventoryItemId != null || link.quantity.trim() !== "");
  const parentText = parentQuantity.trim();
  if (filled.length === 0 && parentText === "") return { ok: true, value: null };
  if (filled.length === 0) return { ok: false, error: "Add the parts this one uses, or clear the ratio." };
  const parent = Number(parentText);
  if (!parentText || !Number.isFinite(parent) || parent <= 0) {
    return { ok: false, error: "Enter how much of this part the ratio uses. For example, 100." };
  }
  const components: { inventoryItemId: number; quantity: number }[] = [];
  const seen = new Set<number>();
  for (const link of filled) {
    if (link.inventoryItemId == null) return { ok: false, error: "Choose each linked part from inventory." };
    if (seen.has(link.inventoryItemId)) return { ok: false, error: "Each linked part can only be listed once." };
    const quantity = Number(link.quantity);
    if (!link.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: "Enter a quantity greater than 0 for each linked part." };
    }
    seen.add(link.inventoryItemId);
    components.push({ inventoryItemId: link.inventoryItemId, quantity: Math.round(quantity * 1_000_000) / 1_000_000 });
  }
  return { ok: true, value: { quantity: Math.round(parent * 1_000_000) / 1_000_000, components } };
}
