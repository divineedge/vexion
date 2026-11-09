/**
 * Measurement-based service pricing resolver — API server copy.
 */

export type PricingBasis = "area" | "linear" | "both";

export interface PricingTier {
  minSqft: number;
  /** null = open-ended "above minSqft" tier */
  maxSqft: number | null;
  /** Flat price for this tier */
  price: number;
  /** Per-sqft rate for the open-ended tier; takes precedence over price when set */
  perSqftRate?: number;
  /** Per-linear-foot rate used when the tier prices both area and perimeter. */
  perLinearFtRate?: number;
  /** Which captured metric this tier evaluates. Absent tiers stay area-based. */
  basis?: PricingBasis;
  /** Optional estimated work time for this measurement tier, in minutes. */
  estimatedMinutes?: number;
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
  pricingMatrix: PricingTier[] | null | undefined,
  areaSqft: number | null | undefined,
  lengthFt: number | null | undefined = 0,
  linearRate: number | null | undefined = 0,
): number {
  const area = areaSqft ?? 0;
  const length = lengthFt ?? 0;
  if (pricingMode === "per_sqft") return basePrice * area;
  if (pricingMode === "per_linear_ft") return basePrice * length;
  if (pricingMode === "area_and_linear") return basePrice * area + (linearRate ?? 0) * length;
  if (pricingMode !== "matrix" || !pricingMatrix || pricingMatrix.length === 0) {
    return basePrice;
  }
  const basis: PricingBasis = pricingMatrix.find((tier) => tier.basis)?.basis ?? "area";
  const quantity = basis === "linear" ? length : area;
  const sorted = [...pricingMatrix].sort((a, b) => a.minSqft - b.minSqft);

  let matched: PricingTier | null = null;
  for (const tier of sorted) {
    if (quantity >= tier.minSqft && (tier.maxSqft === null || quantity <= tier.maxSqft)) {
      matched = tier;
    }
  }
  if (!matched) return basePrice;
  if (basis === "both") {
    const areaCharge = matched.perSqftRate != null && matched.perSqftRate > 0
      ? matched.perSqftRate * area
      : matched.price;
    return areaCharge + (matched.perLinearFtRate ?? linearRate ?? 0) * length;
  }
  if (basis === "linear") {
    if (matched.perLinearFtRate != null && matched.perLinearFtRate > 0) return matched.perLinearFtRate * length;
    if (matched.maxSqft === null && matched.perSqftRate != null && matched.perSqftRate > 0) {
      return matched.perSqftRate * length;
    }
    return matched.price;
  }
  if (matched.maxSqft === null && matched.perSqftRate != null && matched.perSqftRate > 0) {
    return matched.perSqftRate * area;
  }
  return matched.price;
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
  const basis = pricingMatrix?.find((tier) => tier.basis)?.basis;
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
