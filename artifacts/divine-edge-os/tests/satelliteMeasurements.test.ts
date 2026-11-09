import { describe, expect, it } from "vitest";
import { closedPerimeterFt, measureSection, pathLengthFt, polygonAreaSqft } from "../src/lib/satelliteMeasurements";

const square: [number, number][] = [
  [39.0, -104.0],
  [39.0, -104.001],
  [39.001, -104.001],
  [39.001, -104.0],
];

describe("satellite section measurements", () => {
  it("stores area and closed perimeter together", () => {
    const measured = measureSection(square, "both");
    expect(measured.area_sqft).toBeGreaterThan(1000);
    expect(measured.perimeter_linear_feet).toBeGreaterThan(pathLengthFt(square));
    expect(measured.areaSqft).toBe(measured.area_sqft);
    expect(measured.lengthFt).toBe(measured.perimeter_linear_feet);
    expect(measured.perimeter_linear_feet).toBeCloseTo(closedPerimeterFt(square), 5);
  });

  it("keeps a linear section at zero area", () => {
    const measured = measureSection(square.slice(0, 2), "linear");
    expect(measured.area_sqft).toBe(0);
    expect(measured.perimeter_linear_feet).toBeGreaterThan(0);
    expect(polygonAreaSqft(square.slice(0, 2))).toBe(0);
  });
});
