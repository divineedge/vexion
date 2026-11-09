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
});