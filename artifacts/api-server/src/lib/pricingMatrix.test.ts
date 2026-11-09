import { describe, expect, it } from "vitest";
import { resolveServicePrice, type PricingTier } from "./pricingMatrix";

const matrix: PricingTier[] = [
  { minSqft: 0, maxSqft: 999, price: 50 },
  { minSqft: 1000, maxSqft: null, price: 0, perSqftRate: 0.1 },
];

describe("resolveServicePrice", () => {
  it("keeps flat pricing unchanged", () => {
    expect(resolveServicePrice("flat", 75, matrix, 2500, 120)).toBe(75);
  });

  it("prices square-foot services from area", () => {
    expect(resolveServicePrice("per_sqft", 0.04, null, 2500, 120)).toBe(100);
  });

  it("prices linear services from length without using area", () => {
    expect(resolveServicePrice("per_linear_ft", 2.5, null, 0, 120)).toBe(300);
  });

  it("keeps existing area matrix behavior", () => {
    expect(resolveServicePrice("matrix", 75, matrix, 2500, 120)).toBe(250);
  });

  it("adds a per-square-foot charge and a per-linear-foot charge", () => {
    expect(resolveServicePrice("area_and_linear", 0.04, null, 2500, 120, 1.5)).toBe(280);
  });

  it("lets a matrix tier price area and perimeter together", () => {
    const combined: PricingTier[] = [
      { minSqft: 0, maxSqft: null, price: 0, perSqftRate: 0.05, perLinearFtRate: 2, basis: "both" },
    ];
    expect(resolveServicePrice("matrix", 10, combined, 1000, 40)).toBe(130);
  });

  it("prices any number of tiers and lets the last tier cover everything above it", () => {
    const tiers: PricingTier[] = [
      { minSqft: 0, maxSqft: 1000, price: 50, calculationMode: "flat" },
      { minSqft: 1001, maxSqft: 1999, price: 80, calculationMode: "flat" },
      { minSqft: 2000, maxSqft: 3000, price: 40, calculationMode: "per_unit_above_base", unitRate: 1 },
      { minSqft: 3001, maxSqft: 4000, price: 120, calculationMode: "flat" },
    ];
    expect(resolveServicePrice("matrix", 10, tiers, 1500, 0)).toBe(80);
    expect(resolveServicePrice("matrix", 10, tiers, 2100, 0)).toBe(140);
    expect(resolveServicePrice("matrix", 10, tiers, 9000, 0)).toBe(120);
  });

  it("adds the per-unit rate only for measurement above the tier minimum and rounds it", () => {
    const tiers: PricingTier[] = [
      { minSqft: 1000, maxSqft: null, price: 100, calculationMode: "per_unit_above_base", unitRate: 0.33, priceRounding: "nearest_5" },
    ];
    expect(resolveServicePrice("matrix", 10, tiers, 1010, 0)).toBe(105);
    const exact: PricingTier[] = [{ ...tiers[0], priceRounding: "none" }];
    expect(resolveServicePrice("matrix", 10, exact, 1010, 0)).toBe(103.3);
    const dollars: PricingTier[] = [{ ...tiers[0], priceRounding: "nearest_1" }];
    expect(resolveServicePrice("matrix", 10, dollars, 1010, 0)).toBe(103);
    const tens: PricingTier[] = [{ ...tiers[0], priceRounding: "nearest_10" }];
    expect(resolveServicePrice("matrix", 10, tens, 1010, 0)).toBe(100);
  });
});