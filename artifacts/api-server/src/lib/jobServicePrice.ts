export type InvoiceFrequency = "each_time" | "weekly" | "monthly";

export function normalizeInvoiceFrequency(value: unknown): InvoiceFrequency {
  return value === "weekly" || value === "monthly" ? value : "each_time";
}

export function roundJobMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Null when the request did not include a price. A typed 0 is a real price. */
export function parseCallerJobPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return roundJobMoney(amount);
}

/**
 * An office-edited price wins. Otherwise the invoice frequency selects the
 * weekly rate, the monthly rate, or the each-time price (matrix, flat, or measured).
 */
export function chooseJobPrice(input: {
  callerTotal: number | null;
  frequency: InvoiceFrequency;
  eachTimePrice: number | null | undefined;
  weeklyRate: number | null | undefined;
  monthlyRate: number | null | undefined;
}): number | null {
  if (input.callerTotal != null) return input.callerTotal;
  if (input.frequency === "weekly") return roundJobMoney(Number(input.weeklyRate ?? 0));
  if (input.frequency === "monthly") return roundJobMoney(Number(input.monthlyRate ?? 0));
  if (input.eachTimePrice == null || !Number.isFinite(input.eachTimePrice)) return null;
  return roundJobMoney(input.eachTimePrice);
}

/** Keep a measurement breakdown when the amount did not change. An edited price becomes one line. */
export function lineItemsForJobPrice(
  existing: unknown,
  price: number,
  previousTotal: number | null | undefined,
  description: string,
): unknown[] {
  const items = Array.isArray(existing) ? existing : [];
  if (previousTotal != null && Number.isFinite(previousTotal) && Math.abs(previousTotal - price) < 0.005 && items.length > 0) {
    return items;
  }
  const first = items.length === 1 && items[0] && typeof items[0] === "object" ? items[0] as Record<string, unknown> : null;
  const keptDescription = typeof first?.description === "string" && first.description.trim() ? first.description : description;
  return [{
    ...(first ?? {}),
    description: keptDescription,
    quantity: 1,
    qty: 1,
    unitPrice: price,
    total: price,
  }];
}
