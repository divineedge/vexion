import { parseAreaUnit, parseStockUnit, roundStock } from "./chemicalInventory";

export function categoryParts(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map(part => part.trim()).filter(Boolean);
}

/** Rename, merge, or clear one category name inside a stored category string. */
export function rewriteCategory(value: string | null | undefined, from: string, to: string | null): string | null {
  const source = (value ?? "").trim();
  if (!source) return null;
  const parts = categoryParts(source);
  const key = from.trim().toLowerCase();
  if (!key || !parts.some(part => part.toLowerCase() === key)) return source;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const replacement = part.toLowerCase() === key ? (to ?? "") : part;
    const name = replacement.trim();
    if (!name) continue;
    const id = name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(name);
  }
  return next.length ? next.join(", ") : null;
}

export function categoryNames(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    for (const part of categoryParts(value)) {
      const key = part.toLowerCase();
      if (!seen.has(key)) seen.set(key, part);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Blank amount and unit clear the volume. A size volume is gallons, ounces, liters, or pounds. */
export function readSizeVolume(amount: unknown, unit: unknown): { ok: true; amount: number | null; unit: string | null } | { ok: false; error: string } {
  const amountBlank = amount == null || (typeof amount === "string" && amount.trim() === "");
  const unitBlank = unit == null || (typeof unit === "string" && unit.trim() === "");
  if (amountBlank && unitBlank) return { ok: true, amount: null, unit: null };
  if (amountBlank || unitBlank) return { ok: false, error: "Enter both a volume amount and a unit" };
  const value = typeof amount === "number" ? amount : Number(String(amount).trim());
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Volume must be greater than 0" };
  const parsed = parseStockUnit(typeof unit === "string" ? unit : String(unit));
  if (!parsed) return { ok: false, error: "Volume unit must be gallons, ounces, liters, or pounds" };
  return { ok: true, amount: roundStock(value), unit: parsed.canonical };
}

/** Blank amount and unit clear the coverage. Coverage is square feet, not gallons or pounds. */
export function readSizeCoverage(amount: unknown, unit: unknown): { ok: true; amount: number | null; unit: string | null } | { ok: false; error: string } {
  const amountBlank = amount == null || (typeof amount === "string" && amount.trim() === "");
  const unitBlank = unit == null || (typeof unit === "string" && unit.trim() === "");
  if (amountBlank && unitBlank) return { ok: true, amount: null, unit: null };
  if (amountBlank || unitBlank) return { ok: false, error: "Enter both a coverage amount and square feet" };
  const value = typeof amount === "number" ? amount : Number(String(amount).trim());
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Coverage must be greater than 0" };
  const parsed = parseAreaUnit(typeof unit === "string" ? unit : String(unit));
  if (!parsed || parsed.canonical !== "sqft") return { ok: false, error: "Coverage unit must be square feet" };
  return { ok: true, amount: roundStock(value), unit: "sqft" };
}
