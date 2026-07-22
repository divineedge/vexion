/**
 * Area-based pricing matrix resolver.
 * Shared between the API server and the frontend.
 */

export interface PricingTier {
  minSqft: number;
  /** null = open-ended "above minSqft" tier */
  maxSqft: number | null;
  /** Flat price for this tier (when perSqftRate is not set) */
  price: number;
  /** Per-sqft rate for the open-ended tier (overrides price if set) */
  perSqftRate?: number;
}

/**
 * Resolve the price for a service given its pricing config and a property area.
 *
 * - If pricingMode is 'flat' (or no matrix is provided), returns basePrice unchanged.
 * - Otherwise, finds the matching tier for areaSqft and returns:
 *   - tier.price for bounded tiers
 *   - tier.perSqftRate * areaSqft for the open-ended tier when perSqftRate is set
 *   - tier.price otherwise
 * - If no tier matches, falls back to basePrice.
 */
export function resolveServicePrice(
  pricingMode: string,
  basePrice: number,
  pricingMatrix: PricingTier[] | null | undefined,
  areaSqft: number | null | undefined,
): number {
  if (pricingMode !== 'matrix' || !pricingMatrix || pricingMatrix.length === 0) {
    return basePrice;
  }

  const area = areaSqft ?? 0;

  // Sort tiers by minSqft ascending for deterministic matching
  const sorted = [...pricingMatrix].sort((a, b) => a.minSqft - b.minSqft);

  // Find best matching tier
  let matched: PricingTier | null = null;
  for (const tier of sorted) {
    if (area >= tier.minSqft) {
      if (tier.maxSqft === null || area <= tier.maxSqft) {
        matched = tier;
        break; // take first match when traversing sorted descending? No — ascending means we want last match
      }
    }
  }

  // Actually, let's re-implement: find last tier where area >= minSqft (and either no cap or within cap)
  matched = null;
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
