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
