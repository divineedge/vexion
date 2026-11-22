import { describe, expect, it } from "vitest";
import {
  customerPriceFromMarkup,
  customerTotalForParts,
  estimateLinePayload,
  linePatchFromHit,
  passThroughPricePatch,
  searchKindLabel,
  unitPriceForParts,
} from "./lineEntry";

describe("pass-through markup", () => {
  it("adds markup on top of the internal cost", () => {
    expect(customerPriceFromMarkup(100, 25)).toBe(125);
    const patch = passThroughPricePatch({ internalCost: 40, markup: 0, unitPrice: 40 }, { markup: 50 });
    expect(patch.unitPrice).toBe(60);
    expect(patch.priceOverridden).toBe(false);
  });

  it("keeps a typed customer price until cost or markup changes", () => {
    const typed = passThroughPricePatch({ internalCost: 100, markup: 25, unitPrice: 125 }, { unitPrice: 150 });
    expect(typed).toMatchObject({ unitPrice: 150, priceOverridden: true });
  });

  it("fills a saved pass-through without dropping its customer price", () => {
    const patch = linePatchFromHit({
      kind: "pass",
      id: 3,
      description: "Dump truck load",
      unit: "Load",
      internalCost: 80,
      unitPrice: 100,
      markup: 25,
    });
    expect(patch).toMatchObject({
      kind: "custom",
      catalogId: 3,
      description: "Dump truck load",
      unit: "Load",
      internalCost: 80,
      unitPrice: 100,
      markup: 25,
      serviceId: undefined,
      inventoryItemId: null,
    });
    expect(searchKindLabel("pass")).toBe("Pass-through");
    expect(searchKindLabel("service")).toBe("Service");
    expect(searchKindLabel("part")).toBe("Part");
    expect(searchKindLabel("plan")).toBe("Plan");
    expect(searchKindLabel("kit")).toBe("Kit");
  });
});

describe("multi-part customer total", () => {
  it("is one number for every attached part", () => {
    const parts = [
      { quantity: 2, unitPrice: 10 },
      { quantity: 4, unitPrice: 4.25 },
    ];
    expect(unitPriceForParts(1, parts)).toBe(37);
    expect(customerTotalForParts(1, parts)).toBe(37);
    const stored = estimateLinePayload({
      description: "Supplies for the repair",
      qty: 1,
      unitPrice: 37,
      kind: "part",
      inventoryItemId: 9,
      components: [
        { inventoryItemId: 4, name: "Valve", quantity: 2, unit: "ea" },
        { inventoryItemId: 8, name: "Elbow", quantity: 4, unit: null },
      ],
    });
    expect(stored.unitPrice).toBe(37);
    expect(stored.quantity).toBe(1);
    expect(stored.components).toEqual([
      { inventoryItemId: 4, name: "Valve", quantity: 2, unit: "ea" },
      { inventoryItemId: 8, name: "Elbow", quantity: 4, unit: null },
    ]);
    expect(stored.inventoryItemId).toBeNull();
  });

  it("stores attached parts when the line has no catalog kind yet", () => {
    const stored = estimateLinePayload({
      description: "Supplies for the repair",
      qty: 1,
      unitPrice: 37,
      components: [
        { inventoryItemId: 1, name: "Valve", quantity: 2, unit: "each" },
        { inventoryItemId: 2, name: "Fitting", quantity: 4, unit: "each" },
      ],
    });
    expect(stored.kind).toBe("part");
    expect(stored.inventoryItemId).toBeNull();
    expect(stored.serviceId).toBeNull();
    expect(stored.components).toHaveLength(2);
    expect(stored.unitPrice).toBe(37);
  });

  it("keeps a kit pointed at the inventory item and does not invent components", () => {
    const stored = estimateLinePayload(linePatchFromHit({ kind: "kit", id: 12, name: "Zone kit", unitPrice: 40, sku: "ZK" }) as never);
    expect(stored.kind).toBe("kit");
    expect(stored.inventoryItemId).toBe(12);
    expect(stored.components).toBeUndefined();
  });
});
