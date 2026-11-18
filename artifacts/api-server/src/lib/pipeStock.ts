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

/** Per-foot price is what a sale charges when the part has one. */
export function sellUnitPrice(pricePerFoot: number | null | undefined, markedUpPrice: number): number {
  return pricePerFoot != null && Number.isFinite(pricePerFoot) ? pricePerFoot : markedUpPrice;
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
}): { quantity: number; unit: string; sellPrice: number } {
  const trackFeet = input.pipe || input.pricePerFoot != null || input.lengthReceived != null;
  return {
    quantity: stockQuantityForReceipt(input.quantity, input.lengthReceived, trackFeet),
    unit: unitForPipe(input.unit, trackFeet),
    sellPrice: input.pricePerFoot != null ? input.pricePerFoot : input.sellPrice,
  };
}
