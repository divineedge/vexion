import { describe, expect, it } from "vitest";
import {
  convertStockAmount,
  missingChemicalSizeNames,
  planInventoryDeductions,
  quantityAfterReplacement,
  type SprayUsageLine,
} from "./chemicalInventory";

function line(overrides: Partial<SprayUsageLine> & Pick<SprayUsageLine, "amount" | "unit" | "inventoryUnit" | "onHand">): SprayUsageLine {
  return {
    productName: "Roundup",
    inventoryItemId: 7,
    inventoryName: "Roundup",
    ...overrides,
  };
}

describe("gallon and ounce conversion", () => {
  it("converts ounces used into gallons", () => {
    const converted = convertStockAmount(16, "oz", "gal");
    expect(converted).toEqual({ ok: true, amount: 0.125, unit: "gal" });
    expect(quantityAfterReplacement(1, 0, converted.ok ? converted.amount : 0)).toBe(0.875);
  });

  it("converts gallons used into ounces", () => {
    expect(convertStockAmount(0.5, "gallons", "fl oz")).toEqual({ ok: true, amount: 64, unit: "oz" });
    expect(convertStockAmount(1, "gal", "ounces")).toEqual({ ok: true, amount: 128, unit: "oz" });
    const plan = planInventoryDeductions([line({ amount: 0.25, unit: "gal", inventoryUnit: "Ounces", onHand: 128 })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 32, unit: "oz" }] });
    expect(quantityAfterReplacement(128, 0, 32)).toBe(96);
  });

  it("leaves 0.875 gallons when 16 ounces are used from 1 gallon", () => {
    const plan = planInventoryDeductions([line({ amount: 16, unit: "oz", inventoryUnit: "Gallons", onHand: 1 })]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.deductions).toEqual([{ inventoryItemId: 7, quantity: 0.125, unit: "gal" }]);
    expect(quantityAfterReplacement(1, 0, plan.deductions[0].quantity)).toBe(0.875);
  });
});

describe("size volume", () => {
  it("deducts a 2.5 gallon jug as a fraction of one item when the record is in ounces", () => {
    const plan = planInventoryDeductions([line({
      amount: 128,
      unit: "fl oz",
      inventoryUnit: "each",
      onHand: 4,
      sizeVolume: { amount: 2.5, unit: "gal" },
    })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 0.4, unit: "each" }] });
    expect(quantityAfterReplacement(4, 0, 0.4)).toBe(3.6);
  });

  it("keeps a gallon record in ounces when the item is already stocked in ounces", () => {
    const plan = planInventoryDeductions([line({
      amount: 1,
      unit: "gal",
      inventoryUnit: "oz",
      onHand: 200,
      sizeVolume: { amount: 2.5, unit: "gal" },
    })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 128, unit: "oz" }] });
  });

  it("does not convert pounds into a gallon jug", () => {
    const plan = planInventoryDeductions([line({
      amount: 1,
      unit: "lb",
      inventoryUnit: "each",
      onHand: 4,
      sizeVolume: { amount: 2.5, unit: "gal" },
    })]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/Pounds cannot be converted/i);
  });

  it("counts a 5 pound bag from a 2 pound record", () => {
    const plan = planInventoryDeductions([line({
      amount: 2,
      unit: "lb",
      inventoryUnit: "each",
      onHand: 3,
      sizeVolume: { amount: 5, unit: "lb" },
    })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 0.4, unit: "each" }] });
  });
});

describe("size coverage", () => {
  it("drops one roll when 100 square feet are used from a 100 square foot size", () => {
    const plan = planInventoryDeductions([line({
      amount: 100,
      unit: "sq ft",
      inventoryUnit: "each",
      onHand: 4,
      sizeCoverage: { amount: 100, unit: "sqft" },
    })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 1, unit: "each" }] });
    expect(quantityAfterReplacement(4, 0, 1)).toBe(3);
  });

  it("does not convert square feet into gallons or pounds", () => {
    const gallons = planInventoryDeductions([line({
      amount: 100,
      unit: "sq ft",
      inventoryUnit: "gal",
      onHand: 4,
      sizeCoverage: { amount: 100, unit: "sqft" },
    })]);
    expect(gallons.ok).toBe(false);
    if (!gallons.ok) expect(gallons.message).toMatch(/Area cannot be converted to gallons or pounds/i);

    const pounds = planInventoryDeductions([line({
      amount: 1,
      unit: "lb",
      inventoryUnit: "each",
      onHand: 4,
      sizeCoverage: { amount: 100, unit: "sqft" },
    })]);
    expect(pounds.ok).toBe(false);
    if (!pounds.ok) expect(pounds.message).toMatch(/Area cannot be converted to gallons or pounds/i);
  });
});

describe("pound deductions", () => {
  it("deducts pounds from pounds", () => {
    const plan = planInventoryDeductions([line({ amount: 2, unit: "lb", inventoryUnit: "Pounds", onHand: 10 })]);
    expect(plan).toEqual({ ok: true, deductions: [{ inventoryItemId: 7, quantity: 2, unit: "lb" }] });
    expect(quantityAfterReplacement(10, 0, 2)).toBe(8);
  });

  it("refuses to convert pounds to gallons", () => {
    const toGallons = convertStockAmount(2, "lb", "gal");
    expect(toGallons.ok).toBe(false);
    if (!toGallons.ok) expect(toGallons.message).toMatch(/do not match/i);
    if (!toGallons.ok) expect(toGallons.message).toMatch(/Pounds cannot be converted/i);

    const plan = planInventoryDeductions([line({ amount: 1, unit: "gal", inventoryUnit: "Pounds", onHand: 10 })]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.message).toMatch(/do not match/i);
      expect(plan.message).toMatch(/Pounds cannot be converted/i);
    }
    expect(quantityAfterReplacement(10, 0, 0)).toBe(10);
  });

  it("refuses to convert gallons or ounces into pounds", () => {
    expect(convertStockAmount(1, "gal", "pounds").ok).toBe(false);
    expect(convertStockAmount(16, "ounces", "lb").ok).toBe(false);
  });
});

describe("inventory application rules", () => {
  it("does not deduct an unlinked spray product", () => {
    const plan = planInventoryDeductions([line({ inventoryItemId: null, amount: 16, unit: "oz", inventoryUnit: null, onHand: 0 })]);
    expect(plan).toEqual({ ok: true, deductions: [] });
  });

  it("does not invent quantity when stock is short", () => {
    const plan = planInventoryDeductions([line({ amount: 16, unit: "oz", inventoryUnit: "Gallons", onHand: 0.1 })]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.message).toMatch(/Not enough/i);
      expect(plan.message).toMatch(/0\.125/);
      expect(plan.message).toMatch(/0\.1/);
    }
  });

  it("replaces a previous deduction instead of counting it twice", () => {
    const first = planInventoryDeductions([line({ amount: 16, unit: "oz", inventoryUnit: "Gallons", onHand: 1 })]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const afterFirst = quantityAfterReplacement(1, 0, first.deductions[0].quantity);
    expect(afterFirst).toBe(0.875);
    const edited = planInventoryDeductions([line({
      amount: 32,
      unit: "oz",
      inventoryUnit: "Gallons",
      onHand: afterFirst + first.deductions[0].quantity,
    })]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(quantityAfterReplacement(afterFirst, first.deductions[0].quantity, edited.deductions[0].quantity)).toBe(0.75);
    expect(quantityAfterReplacement(0.75, edited.deductions[0].quantity, 0)).toBe(1);
  });

  it("adds gallons, ounces, and pounds without dropping pipe sizes", () => {
    expect(missingChemicalSizeNames(['1/2"', '3/4"'])).toEqual(["Gallons", "Ounces", "Pounds"]);
    expect(missingChemicalSizeNames(["gallons", "Ounces", "pounds", '1"'])).toEqual([]);
  });
});
