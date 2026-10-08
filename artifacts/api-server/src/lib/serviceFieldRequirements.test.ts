import { describe, expect, it } from "vitest";
import { chemicalCompletionError, normalizeFieldRequirements } from "./serviceFieldRequirements";

describe("service field requirements", () => {
  it("normalizes legacy, malformed, and unknown configurations safely", () => {
    expect(normalizeFieldRequirements(null)).toEqual({ requiresChemicalApplication: false, showMaterialsOrParts: false, invoiceDateBasis: "completed" });
    expect(normalizeFieldRequirements({ requiresChemicalApplication: true, futureRequirement: true })).toEqual({
      requiresChemicalApplication: true, showMaterialsOrParts: false, invoiceDateBasis: "completed",
    });
    expect(normalizeFieldRequirements(["invalid"])).toEqual({ requiresChemicalApplication: false, showMaterialsOrParts: false, invoiceDateBasis: "completed" });
  });

  it("blocks completion only for required chemical work without an application", () => {
    expect(chemicalCompletionError({ requiresChemicalApplication: true }, false)).toMatch(/chemical application/i);
    expect(chemicalCompletionError({ requiresChemicalApplication: true }, true)).toBeNull();
    expect(chemicalCompletionError({}, false)).toBeNull();
  });
});