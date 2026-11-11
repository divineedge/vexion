export type TankRateBasis = "per_gallon" | "per_1000_sqft";

export type TankMixLine = {
  productId: number;
  rateBasis: TankRateBasis;
  rate: number;
  ratioUnit: string;
};

export function productConsumed(line: TankMixLine, input: { gallonsSprayed: number; areaSqft: number | null; tankCapacityGallons: number | null; coverageSqft: number | null }): number {
  const rate = Number.isFinite(line.rate) && line.rate > 0 ? line.rate : 0;
  if (line.rateBasis === "per_1000_sqft") {
    if (input.areaSqft != null && input.areaSqft > 0) return round(rate * input.areaSqft / 1000);
    const capacity = input.tankCapacityGallons ?? 0;
    const coverage = input.coverageSqft ?? 0;
    if (capacity > 0 && coverage > 0 && input.gallonsSprayed > 0) return round(rate * coverage / 1000 * (input.gallonsSprayed / capacity));
    return 0;
  }
  return round(rate * Math.max(0, input.gallonsSprayed));
}

export function fullTankLoad(line: TankMixLine, tankCapacityGallons: number | null, coverageSqft: number | null): number {
  return productConsumed(line, {
    gallonsSprayed: tankCapacityGallons ?? 0,
    areaSqft: line.rateBasis === "per_1000_sqft" ? coverageSqft : null,
    tankCapacityGallons,
    coverageSqft,
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
