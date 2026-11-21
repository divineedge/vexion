/**
 * Spray applications draw from the linked inventory item.
 * US liquid: 1 gallon = 128 fluid ounces. Ounces and gallons convert.
 * Pounds stay pounds. Weight and volume never convert (no density).
 */

export const OUNCES_PER_GALLON = 128;
/** US liquid gallon is 3.785411784 liters. */
export const OUNCES_PER_LITER = OUNCES_PER_GALLON / 3.785411784;
export const INCHES_PER_FOOT = 12;

export const CHEMICAL_SIZE_NAMES = ["Gallons", "Ounces", "Pounds"] as const;

export type StockFamily = "liquid" | "weight";
export type CanonicalUnit = "gal" | "oz" | "lb" | "l";

/** Chemical contained in one inventory unit of a size, such as a 2.5 gallon jug. */
export type SizeVolume = { amount: number; unit: string };

/** Area one inventory unit covers, such as 100 square feet per roll. */
export type SizeCoverage = { amount: number; unit: string };

/** Length one size stores, such as 10 feet or 6 inches. */
export type SizeLength = { amount: number; unit: string };

export type ParsedLengthUnit = {
  canonical: "ft" | "in";
  /** Multiply an amount in this unit to get inches. */
  toInches: number;
};

export type ParsedAreaUnit = {
  canonical: "sqft" | "acre" | "sqm";
  /** Multiply an amount in this unit to get square feet. */
  toSqft: number;
};

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
  /** Set when the item's size covers an area, such as 100 square feet per roll. */
  sizeCoverage?: SizeCoverage | null;
  /** Set when the item's size stores a length, such as feet or inches. */
  sizeLength?: SizeLength | null;
};

export type DeductionPlan =
  | { ok: true; deductions: InventoryDeduction[] }
  | { ok: false; message: string };

const GALLONS = new Set(["gal", "gallon", "gallons"]);
const OUNCES = new Set(["oz", "ounce", "ounces", "fl oz", "floz", "fl-oz", "fluid oz", "fluid ounce", "fluid ounces"]);
const LITERS = new Set(["l", "liter", "liters", "litre", "litres"]);
const POUNDS = new Set(["lb", "lbs", "pound", "pounds"]);
const SQUARE_FEET = new Set(["sqft", "sq ft", "square feet", "square foot", "ft2", "ft²"]);
const ACRES = new Set(["acre", "acres"]);
const SQUARE_METERS = new Set(["sqm", "sq m", "m2", "square meter", "square meters", "square metre", "square metres"]);
const FEET = new Set(["ft", "foot", "feet", "linear ft", "linear feet", "pipe ft", "pipe feet", "ln ft"]);
const INCHES = new Set(["in", "inch", "inches", '"', "″"]);

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

export function parseAreaUnit(raw: string | null | undefined): ParsedAreaUnit | null {
  const label = normalizeStockLabel(raw ?? "");
  if (!label) return null;
  if (SQUARE_FEET.has(label)) return { canonical: "sqft", toSqft: 1 };
  if (ACRES.has(label)) return { canonical: "acre", toSqft: 43560 };
  if (SQUARE_METERS.has(label)) return { canonical: "sqm", toSqft: 10.76391041671 };
  return null;
}

/** Feet and inches. Square feet stay area, so they are not a length. */
export function parseLengthUnit(raw: string | null | undefined): ParsedLengthUnit | null {
  if (parseAreaUnit(raw)) return null;
  const label = normalizeStockLabel(raw ?? "");
  if (!label) return null;
  if (FEET.has(label)) return { canonical: "ft", toInches: INCHES_PER_FOOT };
  if (INCHES.has(label)) return { canonical: "in", toInches: 1 };
  return null;
}

/** Square feet for an area amount. Gallons and pounds are not converted. */
export function areaInSquareFeet(amount: number, unit: string): { ok: true; sqft: number } | { ok: false; message: string } {
  const area = parseAreaUnit(unit);
  if (!area) {
    const chemical = parseStockUnit(unit);
    return {
      ok: false,
      message: `Units do not match. This size is square feet and this use is ${unitLabel(unit)}.${chemical ? " Area cannot be converted to gallons or pounds." : ""}`,
    };
  }
  return { ok: true, sqft: roundStock(amount * area.toSqft) };
}

export function chemicalUnitCode(sizeOrUnit: string | null | undefined): CanonicalUnit | null {
  return parseStockUnit(sizeOrUnit)?.canonical ?? null;
}

/**
 * Unit the on-hand quantity is stored in.
 * A size name wins, then the item unit, then a length stored on the size,
 * then pipe that is priced per foot.
 */
export function inventoryStockUnit(
  sizeName: string | null | undefined,
  unit: string | null | undefined,
  options?: { pricePerFoot?: number | null; lengthUnit?: string | null },
): string | null {
  if (parseStockUnit(sizeName) || parseAreaUnit(sizeName) || parseLengthUnit(sizeName)) return sizeName!.trim();
  if (parseStockUnit(unit) || parseAreaUnit(unit) || parseLengthUnit(unit)) return unit!.trim();
  if (options?.lengthUnit && parseLengthUnit(options.lengthUnit)) return options.lengthUnit.trim();
  const stored = (unit ?? "").trim().toLowerCase();
  if (options?.pricePerFoot != null && (stored === "" || stored === "each")) return "ft";
  return null;
}

/** Unit shown next to on-hand quantity. Length stays feet or inches, not a piece count. */
export function displayInventoryUnit(
  sizeName: string | null | undefined,
  unit: string | null | undefined,
  pricePerFoot?: number | null,
  lengthUnit?: string | null,
): string {
  const stored = (unit ?? "").trim();
  const storedEach = stored === "" || stored.toLowerCase() === "each";
  if (pricePerFoot != null && storedEach && !parseAreaUnit(sizeName) && !parseStockUnit(sizeName) && !parseLengthUnit(sizeName)) return "ft";
  if (parseAreaUnit(sizeName)) return "sq ft";
  const sizeChemical = chemicalUnitCode(sizeName);
  if (sizeChemical) return sizeChemical;
  const sizeLength = parseLengthUnit(sizeName);
  if (sizeLength) return sizeLength.canonical;
  if (parseAreaUnit(stored)) return "sq ft";
  const storedLength = parseLengthUnit(stored);
  if (storedLength) return storedLength.canonical;
  if (lengthUnit && parseLengthUnit(lengthUnit) && storedEach && !parseStockUnit(stored) && !parseAreaUnit(stored)) {
    return parseLengthUnit(lengthUnit)!.canonical;
  }
  return stored || "each";
}

export function unitLabel(raw: string | null | undefined): string {
  const parsed = parseStockUnit(raw);
  if (parsed?.canonical === "gal") return "gallons";
  if (parsed?.canonical === "oz") return "ounces";
  if (parsed?.canonical === "l") return "liters";
  if (parsed?.canonical === "lb") return "pounds";
  if (parseAreaUnit(raw)) return "sq ft";
  const length = parseLengthUnit(raw);
  if (length?.canonical === "ft") return "feet";
  if (length?.canonical === "in") return "inches";
  const text = (raw ?? "").trim();
  return text || "units";
}

export function remainingMeasureLabel(quantity: number, unit: string): string {
  return `${formatStockAmount(quantity)} ${unitLabel(unit)}`;
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

/** Feet and inches convert at 12 inches per foot. Length does not become area, volume, or weight. */
export function convertLengthAmount(
  amount: number,
  fromUnit: string,
  toUnit: string,
): { ok: true; amount: number; unit: "ft" | "in" } | { ok: false; message: string } {
  const from = parseLengthUnit(fromUnit);
  const to = parseLengthUnit(toUnit);
  if (!from || !to) {
    if (parseAreaUnit(fromUnit) || parseAreaUnit(toUnit)) {
      return { ok: false, message: "Length cannot be converted to square feet." };
    }
    if (parseStockUnit(fromUnit) || parseStockUnit(toUnit)) {
      return { ok: false, message: "Length cannot be converted to gallons, ounces, or pounds." };
    }
    return { ok: false, message: `Units do not match. Inventory is in ${unitLabel(toUnit)} and this use is in ${unitLabel(fromUnit)}.` };
  }
  return { ok: true, amount: roundStock((amount * from.toInches) / to.toInches), unit: to.canonical };
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
export function deductionForUse(line: Pick<SprayUsageLine, "amount" | "unit" | "inventoryUnit" | "sizeVolume" | "sizeCoverage" | "sizeLength">):
  { ok: true; amount: number; unit: string } | { ok: false; message: string } {
  const useArea = parseAreaUnit(line.unit) != null;
  const useLength = parseLengthUnit(line.unit) != null;
  const stockArea = parseAreaUnit(line.inventoryUnit) != null;
  const stockLength = parseLengthUnit(line.inventoryUnit) != null;
  const stockChemical = parseStockUnit(line.inventoryUnit) != null;
  const useChemical = parseStockUnit(line.unit) != null;
  if ((useArea && stockLength) || (useLength && stockArea)) {
    return { ok: false, message: "Length cannot be converted to square feet." };
  }
  if ((useLength && stockChemical) || (useChemical && stockLength)) {
    return { ok: false, message: "Length cannot be converted to gallons, ounces, or pounds." };
  }
  if (useArea && stockChemical) {
    return { ok: false, message: "Area cannot be converted to gallons or pounds." };
  }
  if (useChemical && stockArea) {
    return { ok: false, message: "Area cannot be converted to gallons or pounds." };
  }
  if (useArea && stockArea) {
    const used = areaInSquareFeet(line.amount, line.unit);
    if (!used.ok) return used;
    return { ok: true, amount: used.sqft, unit: "sqft" };
  }
  if (useLength && stockLength) {
    return convertLengthAmount(line.amount, line.unit, line.inventoryUnit ?? "");
  }
  if (useLength) {
    const stored = line.sizeLength && line.sizeLength.amount > 0 ? parseLengthUnit(line.sizeLength.unit) : null;
    if (stored && !stockChemical && !stockArea) {
      return convertLengthAmount(line.amount, line.unit, line.sizeLength?.unit ?? "");
    }
    return { ok: false, message: "This item is not measured in feet or inches." };
  }
  const coverage = line.sizeCoverage;
  const coverageSqft = coverage && coverage.amount > 0 ? parseAreaUnit(coverage.unit) : null;
  if (coverage && coverageSqft && parseAreaUnit(line.unit)) {
    const used = areaInSquareFeet(line.amount, line.unit);
    if (!used.ok) return used;
    if (parseStockUnit(line.inventoryUnit)) {
      return { ok: false, message: "Area cannot be converted to gallons or pounds." };
    }
    if (parseAreaUnit(line.inventoryUnit)) {
      return { ok: true, amount: used.sqft, unit: "sqft" };
    }
    return {
      ok: true,
      amount: roundStock(used.sqft / coverage.amount),
      unit: (line.inventoryUnit ?? "each").trim() || "each",
    };
  }
  if (parseAreaUnit(line.unit)) {
    return { ok: false, message: "Area cannot be converted to gallons or pounds." };
  }
  if (coverage && coverageSqft && !line.sizeVolume && parseStockUnit(line.unit)) {
    return { ok: false, message: "Area cannot be converted to gallons or pounds." };
  }
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

export function planInventoryDeductions(lines: readonly SprayUsageLine[], action: "application" | "use" = "application"): DeductionPlan {
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
            ? `Units do not match. ${name} is stocked in ${unitLabel(inventoryUnit)} and this ${action} uses ${unitLabel(line.unit)}.${converted.message.includes("Pounds cannot") ? " Pounds cannot be converted to gallons or ounces." : ""}`
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
        message: `Not enough ${row.name} in inventory. This ${action} needs ${formatStockAmount(row.quantity)} ${unitLabel(row.unit)} and ${formatStockAmount(row.onHand)} ${unitLabel(row.unit)} is on hand.`,
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
