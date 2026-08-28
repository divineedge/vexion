import { describe, expect, it } from "vitest";
import {
  buildZoneMeasurementMap,
  resolveServiceMatrixPrice,
  type MeasurementPolygon,
  type MeasurementZoneType,
} from "./servicePlans";

const zoneTypes: MeasurementZoneType[] = [
  { id: "lawn", name: "Front Lawn", mode: "area" },
  { id: "fence", name: "Fence Line", mode: "linear" },
];

const measurements: MeasurementPolygon[] = [
  { id: "area-1", label: "Front Lawn", areaSqft: 400, enabled: true, mode: "area" },
  { id: "linear-1", label: "Fence Line", areaSqft: 0, lengthFt: 70, enabled: true, mode: "linear" },
  { id: "linear-2", zoneTypeId: "fence", areaSqft: 0, lengthFt: 50, enabled: true, mode: "linear" },
  { id: "disabled", zoneTypeId: "fence", areaSqft: 0, lengthFt: 999, enabled: false, mode: "linear" },
];

describe("service plan measurement pricing", () => {
  it("sums area and linear measurements independently by zone type", () => {
    const byZoneType = buildZoneMeasurementMap(measurements, zoneTypes);

    expect(byZoneType.get("lawn")).toEqual({ areaSqft: 400, lengthFt: 0, mode: "area" });
    expect(byZoneType.get("fence")).toEqual({ areaSqft: 0, lengthFt: 120, mode: "linear" });
  });

  it("prices a configured linear-foot service from length", () => {
    expect(resolveServiceMatrixPrice(
      "per_linear_ft",
      2.5,
      null,
      { areaSqft: 0, lengthFt: 120, mode: "linear" },
    )).toBe(300);
  });

  it("uses linear length as the quantity for a matrix linked to a linear zone", () => {
    expect(resolveServiceMatrixPrice(
      "matrix",
      25,
      [{ minSqft: 0, maxSqft: null, price: 0, perSqftRate: 2.5 }],
      { areaSqft: 0, lengthFt: 120, mode: "linear" },
    )).toBe(300);
  });

  it("keeps area matrix resolution unchanged", () => {
    expect(resolveServiceMatrixPrice(
      "matrix",
      25,
      [{ minSqft: 0, maxSqft: 499, price: 50 }, { minSqft: 500, maxSqft: null, price: 80 }],
      { areaSqft: 400, lengthFt: 0, mode: "area" },
    )).toBe(50);
  });
});