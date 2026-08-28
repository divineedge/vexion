import { describe, expect, it } from "vitest";
import { resolveQuoteMeasurements } from "./quotes";

const zoneTypes = [
  { id: "lawn", name: "Front Lawn", mode: "area" as const },
  { id: "fence", name: "Fence Line", mode: "linear" as const },
  { id: "edging", name: "Edging", mode: "linear" as const },
];

const polygons = [
  { label: "Front Lawn", zoneTypeId: "lawn", areaSqft: 400, mode: "area" as const, enabled: true },
  { label: "Fence Line", zoneTypeId: "fence", areaSqft: 0, lengthFt: 120, mode: "linear" as const, enabled: true },
  { label: "Edging", zoneTypeId: "edging", areaSqft: 0, lengthFt: 80, mode: "linear" as const, enabled: true },
];

describe("resolveQuoteMeasurements", () => {
  it("uses persisted selected area instead of a client-provided total", () => {
    const result = resolveQuoteMeasurements(polygons, zoneTypes, ["Front Lawn"], "lawn");
    expect(result).toEqual({ areaSqft: 400, lengthFt: 0, mode: "area" });
  });

  it("prices only the linked linear zone type when selections are mixed", () => {
    const result = resolveQuoteMeasurements(
      polygons,
      zoneTypes,
      ["Front Lawn", "Fence Line", "Edging"],
      "fence",
    );
    expect(result).toEqual({ areaSqft: 0, lengthFt: 120, mode: "linear" });
  });

  it("supports legacy polygons that identify a zone type by label", () => {
    const result = resolveQuoteMeasurements(
      [{ label: "Fence Line", lengthFt: 75, enabled: true }],
      zoneTypes,
      ["Fence Line"],
      "fence",
    );
    expect(result).toEqual({ areaSqft: 0, lengthFt: 75, mode: "linear" });
  });

  it("excludes disabled measurements from the authoritative quantity", () => {
    const result = resolveQuoteMeasurements(
      [
        ...polygons,
        { label: "Fence Line", zoneTypeId: "fence", lengthFt: 500, mode: "linear" as const, enabled: false },
      ],
      zoneTypes,
      ["Fence Line"],
      "fence",
    );
    expect(result).toEqual({ areaSqft: 0, lengthFt: 120, mode: "linear" });
  });
});