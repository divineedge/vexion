/**
 * Area-based pricing matrix resolver — frontend copy.
 */

export interface PricingTier {
  minSqft: number;
  /** null = open-ended "above minSqft" tier */
  maxSqft: number | null;
  /** Flat price for this tier */
  price: number;
  /** Per-sqft rate for the open-ended tier; takes precedence over price when set */
  perSqftRate?: number;
}

/**
 * Resolve the price for a service given its pricing config and a property area.
 *
 * - pricingMode 'flat' → returns basePrice unchanged.
 * - pricingMode 'matrix' → finds the matching tier for areaSqft.
 *   Open-ended tier (maxSqft === null) with perSqftRate: returns rate × area.
 *   Otherwise: returns tier.price.
 * - No matching tier → falls back to basePrice.
 */
export function resolveServicePrice(
  pricingMode: string,
  basePrice: number,
  pricingMatrix: PricingTier[] | null | undefined,
  areaSqft: number | null | undefined,
): number {
  if (pricingMode !== "matrix" || !pricingMatrix || pricingMatrix.length === 0) {
    return basePrice;
  }
  const area = areaSqft ?? 0;
  const sorted = [...pricingMatrix].sort((a, b) => a.minSqft - b.minSqft);

  let matched: PricingTier | null = null;
  for (const tier of sorted) {
    if (area >= tier.minSqft && (tier.maxSqft === null || area <= tier.maxSqft)) {
      matched = tier;
    }
  }
  if (!matched) return basePrice;
  if (matched.maxSqft === null && matched.perSqftRate != null && matched.perSqftRate > 0) {
    return matched.perSqftRate * area;
  }
  return matched.price;
}
