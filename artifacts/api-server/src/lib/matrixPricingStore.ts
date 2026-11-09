import { db, matrixPricingRulesTable, matrixTiersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { readPricingTiers, type PriceRounding, type PricingTier } from "./pricingMatrix";

const ROUNDING = new Set<PriceRounding>(["none", "nearest_1", "nearest_5", "nearest_10"]);

/** Replace the relational matrix for a service. The JSON on services.pricing_matrix stays the copy estimates already read. */
export async function syncServiceMatrix(tenantId: number, serviceId: number, pricingMode: string, pricingMatrix: unknown): Promise<void> {
  await db.delete(matrixPricingRulesTable).where(and(
    eq(matrixPricingRulesTable.tenantId, tenantId),
    eq(matrixPricingRulesTable.serviceId, serviceId),
  ));
  if (pricingMode !== "matrix") return;
  const tiers = readPricingTiers(pricingMatrix);
  if (tiers.length === 0) return;
  const rounding = tiers.find(tier => tier.priceRounding && ROUNDING.has(tier.priceRounding))?.priceRounding ?? "none";
  const basis = tiers.find(tier => tier.basis === "linear" || tier.basis === "both" || tier.basis === "area")?.basis ?? "area";
  const [rule] = await db.insert(matrixPricingRulesTable).values({
    tenantId,
    serviceId,
    basis,
    priceRounding: rounding,
  }).returning();
  await db.insert(matrixTiersTable).values(tiers.map((tier, index) => normalizeTier(rule.id, index, tier, index === tiers.length - 1)));
}

function normalizeTier(ruleId: number, position: number, tier: PricingTier, last: boolean) {
  const calculationMode = tier.calculationMode === "per_unit_above_base" ? "per_unit_above_base" : "flat";
  return {
    ruleId,
    position,
    minQuantity: Number.isFinite(tier.minSqft) ? tier.minSqft : 0,
    maxQuantity: last || tier.maxSqft == null || !Number.isFinite(tier.maxSqft) ? null : tier.maxSqft,
    calculationMode,
    basePrice: Number.isFinite(tier.price) ? tier.price : 0,
    unitRate: calculationMode === "per_unit_above_base" ? (tier.unitRate ?? tier.perSqftRate ?? 0) : null,
    perLinearFtRate: tier.perLinearFtRate ?? null,
    estimatedMinutes: tier.estimatedMinutes ?? null,
  };
}
