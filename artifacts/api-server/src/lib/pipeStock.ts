/** A type such as Pipe or PVC Pipe is sold by the foot. */
export function isPipeTypeName(name: string | null | undefined): boolean {
  return /\bpipe\b/i.test(name ?? "");
}

/** Undefined leaves the stored value. Null clears it. "invalid" is a bad number. */
export function parseOptionalAmount(value: unknown): number | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid";
  return parsed;
}

export function feetFromLength(length: number): number {
  return Math.max(0, Math.round(length));
}

/**
 * Same sell-price formula a normal part uses on its cost:
 * base × (1 + markup% / 100). Pipe uses its per-foot price as that base.
 */
export function priceWithMarkup(base: number, markupPct: number): number {
  const markup = Number.isFinite(markupPct) ? markupPct : 0;
  return base * (1 + markup / 100);
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function finiteAmount(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function moneyNear(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A stored sell price that still equals the buy price, or a pipe sell price
 * that still equals the raw per-foot price, has no item markup of its own.
 */
function ownMarkupPct(cost: number, pricePerFoot: number | null, storedSell: number): number | null {
  if (pricePerFoot != null) {
    if (moneyNear(storedSell, pricePerFoot)) return null;
    if (moneyNear(storedSell, cost) && !moneyNear(cost, pricePerFoot)) return null;
    if (pricePerFoot === 0) return null;
    return ((storedSell / pricePerFoot) - 1) * 100;
  }
  if (cost === 0 || moneyNear(storedSell, cost)) return null;
  return ((storedSell / cost) - 1) * 100;
}

/**
 * Customer sell price for one inventory row.
 * Pipe: per-foot price × (1 + markup% / 100).
 * Any other part: cost × (1 + markup% / 100), keeping a stored sell price when
 * that part already has its own markup. A blank item markup uses the company standard.
 */
export function resolveInventorySell(input: {
  cost: number;
  pricePerFoot?: number | null;
  markedUpPrice: number;
  defaultMarkupPct: number;
  /**
   * Stored item markup. Null means derive it from the stored sell price, where a
   * sell price equal to the buy price uses the company standard. A number, including
   * 0, is an explicit markup and must not be replaced by the company standard.
   */
  itemMarkupPct?: number | null;
}): { sellPrice: number; markupPct: number; pricePerFoot: number | null; usesDefaultMarkup: boolean } {
  const pricePerFoot = finiteAmount(input.pricePerFoot);
  const cost = finiteAmount(input.cost) ?? 0;
  const storedSell = finiteAmount(input.markedUpPrice) ?? 0;
  const standard = finiteAmount(input.defaultMarkupPct) ?? 0;
  const explicit = finiteAmount(input.itemMarkupPct);
  if (explicit != null && explicit >= 0) {
    const markup = roundPct(explicit);
    const base = pricePerFoot ?? cost;
    return {
      sellPrice: roundMoney(priceWithMarkup(base, markup)),
      markupPct: markup,
      pricePerFoot,
      usesDefaultMarkup: false,
    };
  }
  // A zero cost cannot imply a markup. Keep a stored sell price and show the company standard.
  if (pricePerFoot == null && cost === 0) {
    return {
      sellPrice: roundMoney(storedSell),
      markupPct: roundPct(standard),
      pricePerFoot: null,
      usesDefaultMarkup: moneyNear(storedSell, 0),
    };
  }
  const own = ownMarkupPct(cost, pricePerFoot, storedSell);
  const markup = own ?? standard;
  const base = pricePerFoot ?? cost;
  const sellPrice = pricePerFoot != null || own == null
    ? roundMoney(priceWithMarkup(base, markup))
    : roundMoney(storedSell);
  return {
    sellPrice,
    markupPct: roundPct(markup),
    pricePerFoot,
    usesDefaultMarkup: own == null,
  };
}

/**
 * Customer price for one unit. For pipe, markedUpPrice is the per-foot price
 * after inventory markup. The raw per-foot amount is the base and is not charged
 * by itself. A part with no per-foot price keeps its stored sell price.
 */
export function sellUnitPrice(pricePerFoot: number | null | undefined, markedUpPrice: number): number {
  if (pricePerFoot != null && Number.isFinite(pricePerFoot) && !Number.isFinite(markedUpPrice)) return pricePerFoot;
  return markedUpPrice;
}

/** A new pipe receipt with no separate count uses the length as feet on hand. */
export function stockQuantityForReceipt(quantity: number, lengthReceived: number | null, trackFeet: boolean): number {
  if (!trackFeet || lengthReceived == null || quantity > 0) return quantity;
  return feetFromLength(lengthReceived);
}

export function unitForPipe(unit: string | null | undefined, trackFeet: boolean): string {
  const current = (unit ?? "").trim();
  if (trackFeet && (current === "" || current.toLowerCase() === "each")) return "ft";
  return current || "each";
}

export function applyArrival(input: {
  quantity: number;
  unit: string;
  sellPrice: number;
  lengthReceived: number | null;
  pricePerFoot: number | null;
  pipe: boolean;
  /** Markup percent already chosen for this part. Omitted means the per-foot price is used as entered. */
  markupPct?: number;
}): { quantity: number; unit: string; sellPrice: number } {
  const trackFeet = input.pipe || input.pricePerFoot != null || input.lengthReceived != null;
  return {
    quantity: stockQuantityForReceipt(input.quantity, input.lengthReceived, trackFeet),
    unit: unitForPipe(input.unit, trackFeet),
    sellPrice: input.pricePerFoot != null ? priceWithMarkup(input.pricePerFoot, input.markupPct ?? 0) : input.sellPrice,
  };
}
