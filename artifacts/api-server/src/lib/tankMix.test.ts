import { describe, expect, it } from "vitest";
import { fullTankLoad, productConsumed } from "./tankMix";

describe("tank mixture amounts", () => {
  it("uses ounces per gallon for the sprayed volume", () => {
    expect(productConsumed({ productId: 1, rateBasis: "per_gallon", rate: 2, ratioUnit: "oz" }, { gallonsSprayed: 12.5, areaSqft: null, tankCapacityGallons: 50, coverageSqft: null })).toBe(25);
  });

  it("uses the area rate, and the tank ratio when only gallons are entered", () => {
    const line = { productId: 2, rateBasis: "per_1000_sqft" as const, rate: 1.5, ratioUnit: "oz" };
    expect(productConsumed(line, { gallonsSprayed: 50, areaSqft: 20000, tankCapacityGallons: 50, coverageSqft: 40000 })).toBe(30);
    expect(productConsumed(line, { gallonsSprayed: 25, areaSqft: null, tankCapacityGallons: 50, coverageSqft: 40000 })).toBe(30);
    expect(fullTankLoad(line, 50, 40000)).toBe(60);
  });
});