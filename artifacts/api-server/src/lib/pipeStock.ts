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
