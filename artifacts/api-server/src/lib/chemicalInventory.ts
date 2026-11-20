/**
 * Spray applications draw from the linked inventory item.
 * US liquid: 1 gallon = 128 fluid ounces. Ounces and gallons convert.
 * Pounds stay pounds. Weight and volume never convert (no density).
 */

export const OUNCES_PER_GALLON = 128;
/** US liquid gallon is 3.785411784 liters. */
export const OUNCES_PER_LITER = OUNCES_PER_GALLON / 3.785411784;

export const CHEMICAL_SIZE_NAMES = ["Gallons", "Ounces", "Pounds"] as const;

export type StockFamily = "liquid" | "weight";
export type CanonicalUnit = "gal" | "oz" | "lb" | "l";

/** Chemical contained in one inventory unit of a size, such as a 2.5 gallon jug. */
export type SizeVolume = { amount: number; unit: string };

export type ParsedStockUnit = {
  family: StockFamily;
  canonical: CanonicalUnit;
  /** Multiply an amount in this unit to get fluid ounces (liquid) or pounds (weight). */
  toBase: number;
};

export type InventoryDeduction = {
  inventoryItemId: number;
  quantity: number;
  /** gal, oz, l, lb, or the item's own unit when the size volume counts containers. */
  unit: string;
};

export type SprayUsageLine = {
  productName: string;
  amount: number;
  unit: string;
  inventoryItemId: number | null;
  inventoryName: string;
  /** Null when the linked item has no gallon, ounce, or pound unit. */
  inventoryUnit: string | null;
  /** Quantity available in the inventory unit, including any amount this edit will put back. */
  onHand: number;
  /** Set when the item's size holds a volume, such as 2.5 gallons per jug. */
  sizeVolume?: SizeVolume | null;
};

export type DeductionPlan =
  | { ok: true; deductions: InventoryDeduction[] }
  | { ok: false; message: string };

const GALLONS = new Set(["gal", "gallon", "gallons"]);
const OUNCES = new Set(["oz", "ounce", "ounces", "fl oz", "floz", "fl-oz", "fluid oz", "fluid ounce", "fluid ounces"]);
const LITERS = new Set(["l", "liter", "liters", "litre", "litres"]);
const POUNDS = new Set(["lb", "lbs", "pound", "pounds"]);

export function roundStock(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function formatStockAmount(value: number): string {
  const rounded = roundStock(value);
  if (!Number.isFinite(rounded)) return "0";
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

export function normalizeStockLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\./g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function parseStockUnit(raw: string | null | undefined): ParsedStockUnit | null {
  const label = normalizeStockLabel(raw ?? "");
  if (!label) return null;
  if (GALLONS.has(label)) return { family: "liquid", canonical: "gal", toBase: OUNCES_PER_GALLON };
  if (OUNCES.has(label)) return { family: "liquid", canonical: "oz", toBase: 1 };
  if (LITERS.has(label)) return { family: "liquid", canonical: "l", toBase: OUNCES_PER_LITER };
  if (POUNDS.has(label)) return { family: "weight", canonical: "lb", toBase: 1 };
  return null;
}

export function chemicalUnitCode(sizeOrUnit: string | null | undefined): CanonicalUnit | null {
  return parseStockUnit(sizeOrUnit)?.canonical ?? null;
}

/** Prefer a chemical size name (Gallons, Ounces, Pounds). Fall back to the item unit. */
export function inventoryStockUnit(sizeName: string | null | undefined, unit: string | null | undefined): string | null {
  if (parseStockUnit(sizeName)) return sizeName!.trim();
  if (parseStockUnit(unit)) return unit!.trim();
  return null;
}

export function unitLabel(raw: string | null | undefined): string {
  const parsed = parseStockUnit(raw);
  if (parsed?.canonical === "gal") return "gallons";
  if (parsed?.canonical === "oz") return "ounces";
  if (parsed?.canonical === "l") return "liters";
  if (parsed?.canonical === "lb") return "pounds";
  const text = (raw ?? "").trim();
  return text || "units";
}

export function missingChemicalSizeNames(existingNames: readonly string[]): string[] {
  const have = new Set(existingNames.map(name => name.trim().toLowerCase()));
  return CHEMICAL_SIZE_NAMES.filter(name => !have.has(name.toLowerCase()));
}

export function convertStockAmount(
  amount: number,
  fromUnit: string,
  toUnit: string,
): { ok: true; amount: number; unit: CanonicalUnit } | { ok: false; message: string } {
  const from = parseStockUnit(fromUnit);
  const to = parseStockUnit(toUnit);
  if (!from || !to || from.family !== to.family) {
    const fromLabel = unitLabel(from ? fromUnit : fromUnit);
    const toLabel = unitLabel(to ? toUnit : toUnit);
    const cross = (from?.family === "weight" && to?.family === "liquid") || (from?.family === "liquid" && to?.family === "weight");
    const sentence = cross
      ? " Pounds cannot be converted to gallons or ounces."
      : "";
    return {
      ok: false,
      message: `Units do not match. Inventory is in ${toLabel} and the application is in ${fromLabel}.${sentence}`,
    };
  }
  return { ok: true, amount: roundStock((amount * from.toBase) / to.toBase), unit: to.canonical };
}

/**
 * Amount to remove from inventory for one spray line.
 * A size volume is the chemical in one inventory unit (a 2.5 gallon jug).
 * The record amount is converted into that volume's unit, then divided by the
 * volume, so the deduction is a count of those units. Gallons and ounces
 * convert at 128 fl oz per gallon. Pounds are not converted to liquid.
 * When the item is already stocked in gallons, ounces, liters, or pounds, the
 * record amount is converted into that stock unit instead, so the record and
 * the inventory stay in the same units.
 */
export function deductionForUse(line: Pick<SprayUsageLine, "amount" | "unit" | "inventoryUnit" | "sizeVolume">):
  { ok: true; amount: number; unit: string } | { ok: false; message: string } {
  const volume = line.sizeVolume;
  const volumeUnit = volume && volume.amount > 0 ? parseStockUnit(volume.unit) : null;
  const stockUnit = parseStockUnit(line.inventoryUnit);
  if (volume && volumeUnit && !stockUnit) {
    const converted = convertStockAmount(line.amount, line.unit, volume.unit);
    if (!converted.ok) {
      const pounds = converted.message.includes("Pounds cannot");
      return {
        ok: false,
        message: `Units do not match. This size is ${unitLabel(volume.unit)} per item and this application uses ${unitLabel(line.unit)}.${pounds ? " Pounds cannot be converted to gallons or ounces." : ""}`,
      };
    }
    return {
      ok: true,
      amount: roundStock(converted.amount / volume.amount),
      unit: (line.inventoryUnit ?? "each").trim() || "each",
    };
  }
  return convertStockAmount(line.amount, line.unit, line.inventoryUnit ?? "");
}

export function planInventoryDeductions(lines: readonly SprayUsageLine[]): DeductionPlan {
  const grouped = new Map<number, { quantity: number; unit: string; name: string; onHand: number }>();
  for (const line of lines) {
    if (line.inventoryItemId == null) continue;
    if (!(line.amount > 0) || !Number.isFinite(line.amount)) continue;
    const inventoryUnit = line.inventoryUnit ?? "";
    const converted = deductionForUse(line);
    if (!converted.ok) {
      const name = line.inventoryName || line.productName;
      return {
        ok: false,
        message: converted.message.includes("This size is")
          ? converted.message.replace("This size", name)
          : converted.message.includes("Units do not match")
            ? `Units do not match. ${name} is stocked in ${unitLabel(inventoryUnit)} and this application uses ${unitLabel(line.unit)}.${converted.message.includes("Pounds cannot") ? " Pounds cannot be converted to gallons or ounces." : ""}`
            : converted.message,
      };
    }
    const current = grouped.get(line.inventoryItemId) ?? {
      quantity: 0,
      unit: converted.unit,
      name: line.inventoryName || line.productName,
      onHand: line.onHand,
    };
    current.quantity = roundStock(current.quantity + converted.amount);
    grouped.set(line.inventoryItemId, current);
  }

  const deductions: InventoryDeduction[] = [];
  for (const [inventoryItemId, row] of grouped) {
    if (row.quantity - row.onHand > 1e-6) {
      return {
        ok: false,
        message: `Not enough ${row.name} in inventory. This application needs ${formatStockAmount(row.quantity)} ${unitLabel(row.unit)} and ${formatStockAmount(row.onHand)} ${unitLabel(row.unit)} is on hand.`,
      };
    }
    deductions.push({ inventoryItemId, quantity: row.quantity, unit: row.unit });
  }
  return { ok: true, deductions };
}

/** Quantity left after replacing a previous deduction with a new one. */
export function quantityAfterReplacement(current: number, previousDeduction: number, nextDeduction: number): number {
  return roundStock(current + previousDeduction - nextDeduction);
}

export function readInventoryDeductions(value: unknown): InventoryDeduction[] {
  if (!Array.isArray(value)) return [];
  const totals = new Map<number, InventoryDeduction>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const inventoryItemId = Number(row.inventoryItemId);
    const quantity = Number(row.quantity);
    const rawUnit = typeof row.unit === "string" ? row.unit.trim() : "";
    const unit = parseStockUnit(rawUnit)?.canonical ?? (rawUnit || "gal");
    if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
    const existing = totals.get(inventoryItemId);
    if (existing) existing.quantity = roundStock(existing.quantity + quantity);
    else totals.set(inventoryItemId, { inventoryItemId, quantity: roundStock(quantity), unit });
  }
  return [...totals.values()];
}
