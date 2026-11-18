import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  categoryChoices,
  feetFromLength,
  inventorySizeOptions,
  isPipeTypeName,
  namedId,
  sizeIdAcrossTypes,
} from "../src/lib/inventoryPartForm";
import {
  applyArrival,
  parseOptionalAmount,
  sellUnitPrice,
  stockQuantityForReceipt,
  unitForPipe,
} from "../../api-server/src/lib/pipeStock";

const inventoryPage = readFileSync(new URL("../src/pages/inventory.tsx", import.meta.url), "utf8");

describe("categoryChoices", () => {
  it("lists stored categories, a new draft, and the current selection once", () => {
    expect(categoryChoices(["Valves, Pipe", "Valves"], ["Irrigation"], "irrigation")).toEqual([
      "Irrigation",
      "Pipe",
      "Valves",
    ]);
  });
});

describe("pipe arrival", () => {
  it("recognizes a pipe type and turns a receipt into feet on hand", () => {
    expect(isPipeTypeName("Pipe")).toBe(true);
    expect(isPipeTypeName("PVC Pipe")).toBe(true);
    expect(isPipeTypeName("Fitting")).toBe(false);
    expect(feetFromLength(100.4)).toBe(100);
    expect(stockQuantityForReceipt(0, 100.4, true)).toBe(100);
    expect(stockQuantityForReceipt(12, 100, true)).toBe(12);
    expect(unitForPipe("each", true)).toBe("ft");
    expect(sellUnitPrice(2.5, 9)).toBe(2.5);
    expect(sellUnitPrice(null, 9)).toBe(9);
    expect(applyArrival({
      quantity: 0,
      unit: "each",
      sellPrice: 4,
      lengthReceived: 40,
      pricePerFoot: 1.75,
      pipe: true,
    })).toEqual({ quantity: 40, unit: "ft", sellPrice: 1.75 });
    expect(parseOptionalAmount("")).toBeNull();
    expect(parseOptionalAmount(-1)).toBe("invalid");
    expect(namedId([{ id: 3, name: "Pipe" }], " pipe ")).toBe(3);
  });
});

describe("shared inventory sizes", () => {
  it("lists sizes from every type and keeps the selection when the type changes", () => {
    expect(inventorySizeOptions([
      { id: 3, name: "elbow" },
      { id: 1, name: '1"' },
      { id: 2, name: '2"' },
    ])).toEqual([
      { value: "1", label: '1"' },
      { value: "2", label: '2"' },
      { value: "3", label: "elbow" },
    ]);
    expect(sizeIdAcrossTypes("3", [{ id: 1 }, { id: 3 }])).toBe("3");
    expect(sizeIdAcrossTypes("9", [{ id: 1 }])).toBe("");
  });
});

describe("add inventory form", () => {
  it("uses sheet-safe menus for type, size, category, and vendors", () => {
    expect(inventoryPage).toContain("isFromPickerPortal");
    expect(inventoryPage).toContain('testId="select-part-type"');
    expect(inventoryPage).toContain('testId="select-part-size"');
    expect(inventoryPage).toContain('testId="select-part-category"');
    expect(inventoryPage).toContain('testId="select-part-supplier"');
    expect(inventoryPage).toContain("useListVendors");
    expect(inventoryPage).toContain("inventorySizeOptions(partSizes)");
    expect(inventoryPage).not.toContain("sizesForType(partSizes");
    expect(inventoryPage).not.toContain("sizeIdForType");
    expect(inventoryPage).toContain('data-testid="input-length-received"');
    expect(inventoryPage).toContain('data-testid="input-price-per-foot"');
    expect(inventoryPage).not.toContain("New Supplier");
    expect(inventoryPage).not.toContain("e.g. Ewing Irrigation");
  });
});
