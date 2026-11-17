import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_EQUIPMENT_TYPE,
  equipmentTypeAfterPick,
  equipmentTypeFieldState,
} from "../src/lib/equipmentTypeField";

const equipmentPage = readFileSync(
  new URL("../src/pages/equipment.tsx", import.meta.url),
  "utf8",
);
const labels = ["Mower", "Truck", "Trailer"];

describe("add equipment type field", () => {
  it("keeps a saved type selected once the list has loaded", () => {
    expect(equipmentTypeAfterPick("Mower", "", labels)).toEqual({
      type: "Mower",
      customMode: false,
    });
    expect(
      equipmentTypeFieldState({
        type: "Mower",
        labels,
        customMode: false,
        typesLoaded: true,
      }),
    ).toEqual({ pickerValue: "Mower", showCustomInput: false });
  });

  it("does not treat a saved type as custom before the type list loads", () => {
    expect(
      equipmentTypeFieldState({
        type: "Mower",
        labels: [],
        customMode: false,
        typesLoaded: false,
      }),
    ).toEqual({ pickerValue: null, showCustomInput: false });
  });

  it("opens a custom entry when the saved type is not in the list", () => {
    expect(
      equipmentTypeFieldState({
        type: "Skid steer",
        labels,
        customMode: false,
        typesLoaded: true,
      }),
    ).toEqual({ pickerValue: CUSTOM_EQUIPMENT_TYPE, showCustomInput: true });
    expect(
      equipmentTypeAfterPick(CUSTOM_EQUIPMENT_TYPE, "Mower", labels),
    ).toEqual({
      type: "",
      customMode: true,
    });
    expect(
      equipmentTypeAfterPick(CUSTOM_EQUIPMENT_TYPE, "Skid steer", labels),
    ).toEqual({
      type: "Skid steer",
      customMode: true,
    });
  });

  it("uses the sheet-safe type picker instead of a native suggestion list", () => {
    expect(equipmentPage).toContain('ariaLabel="Equipment type"');
    expect(equipmentPage).toContain("isFromPickerPortal");
    expect(equipmentPage).not.toContain("equipment-type-options");
    expect(equipmentPage).not.toContain("<datalist");
  });
});
