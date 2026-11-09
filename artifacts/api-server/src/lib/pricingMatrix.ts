/**
 * Measurement-based service pricing resolver — API server copy.
 */

export type PricingBasis = "area" | "linear" | "both";
export type TierCalculationMode = "flat" | "per_unit_above_base";
export type PriceRounding = "none" | "nearest_1" | "nearest_5" | "nearest_10";

export interface PricingTier {
  minSqft: number;
  /** null = open-ended "above minSqft" tier. The last tier is always open-ended. */
  maxSqft: number | null;
  /** Flat price, or the base that covers up to this tier's minimum. */
  price: number;
  /** flat = one price for the range. per_unit_above_base = base plus a rate past the minimum. */
  calculationMode?: TierCalculationMode;
  /** Dollars charged for each unit above the tier minimum. */
  unitRate?: number;
  /** Per-sqft rate for older open-ended tiers; takes precedence over price when calculationMode is absent. */
  perSqftRate?: number;
  /** Per-linear-foot rate used when the tier prices both area and perimeter. */
  perLinearFtRate?: number;
  /** Which captured metric this tier evaluates. Absent tiers stay area-based. */
  basis?: PricingBasis;
  /** Optional estimated work time for this measurement tier, in minutes. */
  estimatedMinutes?: number;
  /** Applied to this tier's calculated amount. */
  priceRounding?: PriceRounding;
}

export function readPricingTiers(value: unknown): PricingTier[] {
  if (Array.isArray(value)) return value as PricingTier[];
  if (value && typeof value === "object" && Array.isArray((value as { tiers?: unknown }).tiers)) {
    const doc = value as { tiers: PricingTier[]; priceRounding?: PriceRounding };
    return doc.tiers.map(tier => ({ ...tier, priceRounding: tier.priceRounding ?? doc.priceRounding }));
  }
  return [];
}

export function roundMatrixPrice(amount: number, rounding: PriceRounding | null | undefined): number {
  if (!Number.isFinite(amount)) return 0;
  let rounded = amount;
  if (rounding === "nearest_1") rounded = Math.round(amount);
  else if (rounding === "nearest_5") rounded = Math.round(amount / 5) * 5;
  else if (rounding === "nearest_10") rounded = Math.round(amount / 10) * 10;
  return Math.round((rounded + Number.EPSILON) * 100) / 100;
}

function matchPricingTier(sorted: PricingTier[], quantity: number): PricingTier | null {
  let matched: PricingTier | null = null;
  for (const tier of sorted) {
    if (quantity >= tier.minSqft && (tier.maxSqft === null || quantity <= tier.maxSqft)) matched = tier;
  }
  if (matched) return matched;
  const last = sorted[sorted.length - 1];
  if (last && quantity >= last.minSqft) return last;
  return null;
}

function tierAmount(tier: PricingTier, basis: PricingBasis, quantity: number, area: number, length: number, linearRate: number): number {
  const extraLinear = basis === "both" ? (tier.perLinearFtRate ?? linearRate) * length : 0;
  if (tier.calculationMode === "per_unit_above_base") {
    const rate = tier.unitRate ?? tier.perSqftRate ?? 0;
    const above = Math.max(0, quantity - tier.minSqft) * rate;
    return roundMatrixPrice(tier.price + above + extraLinear, tier.priceRounding);
  }
  if (tier.calculationMode === "flat") return roundMatrixPrice(tier.price + extraLinear, tier.priceRounding);
  if (basis === "both") {
    const areaCharge = tier.perSqftRate != null && tier.perSqftRate > 0 ? tier.perSqftRate * area : tier.price;
    return roundMatrixPrice(areaCharge + extraLinear, tier.priceRounding);
  }
  if (basis === "linear") {
    if (tier.perLinearFtRate != null && tier.perLinearFtRate > 0) return roundMatrixPrice(tier.perLinearFtRate * length, tier.priceRounding);
    if (tier.maxSqft === null && tier.perSqftRate != null && tier.perSqftRate > 0) return roundMatrixPrice(tier.perSqftRate * length, tier.priceRounding);
    return roundMatrixPrice(tier.price, tier.priceRounding);
  }
  if (tier.maxSqft === null && tier.perSqftRate != null && tier.perSqftRate > 0) return roundMatrixPrice(tier.perSqftRate * area, tier.priceRounding);
  return roundMatrixPrice(tier.price, tier.priceRounding);
}

/**
 * Resolve the price for a service given its pricing config and property measurements.
 *
 * - pricingMode 'flat' → returns basePrice unchanged.
 * - pricingMode 'per_sqft' → returns basePrice × areaSqft.
 * - pricingMode 'per_linear_ft' → returns basePrice × lengthFt.
 * - pricingMode 'area_and_linear' → basePrice × area plus linearRate × perimeter.
 * - pricingMode 'matrix' → finds the matching tier.
 *   basis 'linear' matches perimeter feet. basis 'both' adds the linear rate
 *   to the area charge. Absent basis stays area-based.
 * - No matching tier → falls back to basePrice.
 */
export function resolveServicePrice(
  pricingMode: string,
  basePrice: number,
  pricingMatrix: PricingTier[] | { tiers?: PricingTier[]; priceRounding?: PriceRounding } | null | undefined,
  areaSqft: number | null | undefined,
  lengthFt: number | null | undefined = 0,
  linearRate: number | null | undefined = 0,
): number {
  const area = areaSqft ?? 0;
  const length = lengthFt ?? 0;
  if (pricingMode === "per_sqft") return basePrice * area;
  if (pricingMode === "per_linear_ft") return basePrice * length;
  if (pricingMode === "area_and_linear") return basePrice * area + (linearRate ?? 0) * length;
  const tiers = readPricingTiers(pricingMatrix);
  if (pricingMode !== "matrix" || tiers.length === 0) return basePrice;
  const basis: PricingBasis = tiers.find((tier) => tier.basis)?.basis ?? "area";
  const quantity = basis === "linear" ? length : area;
  const sorted = [...tiers].sort((a, b) => a.minSqft - b.minSqft);
  const matched = matchPricingTier(sorted, quantity);
  if (!matched) return basePrice;
  return tierAmount(matched, basis, quantity, area, length, linearRate ?? 0);
}

export interface MeasurementChargeLine {
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
}

/** Line items a quote or estimate can show for one measured service. */
export function measurementChargeLines(
  name: string,
  pricingMode: string,
  basePrice: number,
  linearRate: number,
  pricingMatrix: PricingTier[] | null | undefined,
  areaSqft: number,
  lengthFt: number,
): MeasurementChargeLine[] {
  if (pricingMode === "area_and_linear") {
    const lines: MeasurementChargeLine[] = [];
    if (areaSqft > 0) {
      lines.push({
        description: `${name} (${Math.round(areaSqft).toLocaleString()} sq ft)`,
        qty: areaSqft,
        unitPrice: basePrice,
        total: basePrice * areaSqft,
      });
    }
    if (lengthFt > 0) {
      lines.push({
        description: `${name} (${Math.round(lengthFt).toLocaleString()} linear ft)`,
        qty: lengthFt,
        unitPrice: linearRate,
        total: linearRate * lengthFt,
      });
    }
    return lines;
  }
  const total = resolveServicePrice(pricingMode, basePrice, pricingMatrix, areaSqft, lengthFt, linearRate);
  const basis = readPricingTiers(pricingMatrix).find((tier) => tier.basis)?.basis;
  const metric = pricingMode === "per_linear_ft" || basis === "linear"
    ? `${Math.round(lengthFt).toLocaleString()} linear ft`
    : pricingMode === "per_sqft" || basis === "area" || !basis
      ? `${Math.round(areaSqft).toLocaleString()} sq ft`
      : `${Math.round(areaSqft).toLocaleString()} sq ft + ${Math.round(lengthFt).toLocaleString()} linear ft`;
  const qty = pricingMode === "per_sqft" ? areaSqft : pricingMode === "per_linear_ft" ? lengthFt : 1;
  const unitPrice = qty > 0 && pricingMode !== "matrix" && pricingMode !== "flat" ? basePrice : total;
  return [{
    description: pricingMode === "flat" ? name : `${name} (${metric})`,
    qty: qty > 0 ? qty : 1,
    unitPrice,
    total,
  }];
}
