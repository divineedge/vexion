import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  categoryChoices,
  feetFromLength,
  inventorySizeOptions,
  isPipeTypeName,
  namedId,
  inventoryListFigures,
  pipeSellPerFoot,
  priceWithMarkup,
  sizeIdAcrossTypes,
} from "../src/lib/inventoryPartForm";
import {
  applyArrival,
  parseOptionalAmount,
  priceWithMarkup as serverPriceWithMarkup,
  resolveInventorySell,
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
    expect(sellUnitPrice(2.5, 9)).toBe(9);
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

describe("pipe foot markup", () => {
  it("adds the same markup a normal part adds to its cost, and charges that sell price", () => {
    const markup = 20;
    const normalSell = 10 * (1 + markup / 100);
    expect(priceWithMarkup(10, markup)).toBe(normalSell);
    expect(serverPriceWithMarkup(10, markup)).toBe(normalSell);
    expect(priceWithMarkup(2.5, markup)).toBe(serverPriceWithMarkup(2.5, markup));
    expect(priceWithMarkup(2.5, markup)).toBeCloseTo(3, 10);
    expect(pipeSellPerFoot("2.50", "20", 35)).toBeCloseTo(3, 10);
    expect(pipeSellPerFoot("2.50", "", 20)).toBeCloseTo(3, 10);
    expect(pipeSellPerFoot("", "20", 20)).toBeNull();

    const pipe = applyArrival({
      quantity: 0,
      unit: "each",
      sellPrice: normalSell,
      lengthReceived: 100,
      pricePerFoot: 2.5,
      pipe: true,
      markupPct: markup,
    });
    expect(pipe).toEqual({ quantity: 100, unit: "ft", sellPrice: priceWithMarkup(2.5, markup) });
    expect(sellUnitPrice(2.5, pipe.sellPrice)).toBe(pipe.sellPrice);

    const fitting = applyArrival({
      quantity: 4,
      unit: "each",
      sellPrice: normalSell,
      lengthReceived: null,
      pricePerFoot: null,
      pipe: false,
      markupPct: markup,
    });
    expect(fitting).toEqual({ quantity: 4, unit: "each", sellPrice: normalSell });
    expect(sellUnitPrice(null, fitting.sellPrice)).toBe(normalSell);
  });
});

describe("inventory list sell price and company markup", () => {
  it("shows the per-foot price and marks it up, and uses the company standard when an item markup is blank", () => {
    const standard = 25;
    const pipeBlank = resolveInventorySell({ cost: 10, pricePerFoot: 2, markedUpPrice: 10, defaultMarkupPct: standard });
    expect(pipeBlank).toMatchObject({ pricePerFoot: 2, markupPct: standard, sellPrice: 2.5, usesDefaultMarkup: true });
    expect(inventoryListFigures({
      costPrice: 10, pricePerFoot: 2, unitPrice: 10, markupPct: 0, defaultMarkupPct: standard,
    })).toEqual({ pricePerFoot: 2, markupPct: standard, sellPrice: 2.5 });

    const pipeOverride = resolveInventorySell({ cost: 10, pricePerFoot: 2.5, markedUpPrice: 3, defaultMarkupPct: standard });
    expect(pipeOverride).toMatchObject({ pricePerFoot: 2.5, markupPct: 20, sellPrice: 3, usesDefaultMarkup: false });
    expect(inventoryListFigures({
      costPrice: 10, pricePerFoot: 2.5, unitPrice: 3, markupPct: 20, defaultMarkupPct: standard,
    })).toEqual({ pricePerFoot: 2.5, markupPct: 20, sellPrice: 3 });

    const supplyBlank = resolveInventorySell({ cost: 10, pricePerFoot: null, markedUpPrice: 10, defaultMarkupPct: standard });
    expect(supplyBlank).toMatchObject({ pricePerFoot: null, markupPct: standard, sellPrice: 12.5, usesDefaultMarkup: true });
    expect(inventoryListFigures({
      costPrice: 10, pricePerFoot: null, unitPrice: 10, markupPct: 0, defaultMarkupPct: standard,
    })).toEqual({ pricePerFoot: null, markupPct: standard, sellPrice: 12.5 });

    const supplyOverride = resolveInventorySell({ cost: 10, pricePerFoot: null, markedUpPrice: 12, defaultMarkupPct: standard });
    expect(supplyOverride).toMatchObject({ markupPct: 20, sellPrice: 12, usesDefaultMarkup: false });
    expect(inventoryListFigures({
      costPrice: 10, pricePerFoot: null, unitPrice: 12, markupPct: 20, defaultMarkupPct: standard,
    })).toEqual({ pricePerFoot: null, markupPct: 20, sellPrice: 12 });

    const resolvedPipe = inventoryListFigures({
      costPrice: 10, pricePerFoot: 2, unitPrice: pipeBlank.sellPrice, markupPct: pipeBlank.markupPct, defaultMarkupPct: standard,
    });
    expect(resolvedPipe).toEqual({ pricePerFoot: 2, markupPct: standard, sellPrice: 2.5 });
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
    expect(inventoryPage).toContain("pipeSellPerFoot(form.pricePerFoot, form.markupPct, defaultMarkupPct)");
    expect(inventoryPage).toContain("inventoryListFigures");
    expect(inventoryPage).toContain("Price / ft");
    expect(inventoryPage).toContain("list-price-per-foot-");
    expect(inventoryPage).toContain("list-sell-price-");
    expect(inventoryPage).toContain("list-markup-");
    expect(inventoryPage).toContain('data-testid="text-sell-price"');
    expect(inventoryPage).toContain("c * (1 + m / 100)");
    expect(inventoryPage).not.toContain("New Supplier");
    expect(inventoryPage).not.toContain("e.g. Ewing Irrigation");
  });
});
