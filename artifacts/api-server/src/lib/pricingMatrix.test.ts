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
});