import { describe, expect, it } from "vitest";
import { encodeLineItemsCell, decodeLineItemsCell, sumLineItems } from "./importExport";
import {
  acceptanceAmount,
  customLineEconomics,
  lineExtendedPrice,
  normalizeComponents,
  prepareLineItems,
} from "./customLineItems";

const serviceLine = {
  id: "svc-1",
  description: "Weekly mow",
  qty: 1,
  unitPrice: 100,
  markup: 10,
  discount: 0,
  isOptional: false,
  acceptedByCustomer: true,
  serviceId: 7,
};

describe("custom pass-through lines", () => {
  it("leaves existing service and part lines untouched", () => {
    const part = { description: "Valve", quantity: 2, unitPrice: 12, inventoryItemId: 4, serviceId: null };
    const prepared = prepareLineItems([serviceLine, part], "estimate");
    expect(prepared[0]).toBe(serviceLine);
    expect(prepared[1]).toBe(part);
    expect(lineExtendedPrice(serviceLine)).toBeCloseTo(110, 5);
  });

  it("prices a custom line as quantity times unit price and clears catalog ids", () => {
    const [line] = prepareLineItems([{
      kind: "custom",
      description: " Dump Truck Load ",
      qty: 2,
      unit: "Load",
      internalCost: 40,
      unitPrice: 75,
      markup: 25,
      discount: 10,
      serviceId: 9,
      inventoryItemId: 3,
      partId: 3,
    }], "estimate");
    expect(line).toMatchObject({
      kind: "custom",
      description: "Dump Truck Load",
      qty: 2,
      quantity: 2,
      unit: "Load",
      internalCost: 40,
      unitPrice: 75,
      total: 150,
      markup: 25,
      discount: 0,
      serviceId: null,
      inventoryItemId: null,
      partId: null,
    });
    expect(lineExtendedPrice(line as { kind: string; qty: number; unitPrice: number; markup: number })).toBe(150);
    expect(customLineEconomics([line])).toEqual({ sell: 150, cost: 80 });
  });

  it("includes custom lines in a deposit without requiring a service", () => {
    const total = lineExtendedPrice(serviceLine) + lineExtendedPrice({ kind: "custom", qty: 2, unitPrice: 75, markup: 50 });
    expect(total).toBe(260);
    expect(acceptanceAmount("deposit_pct", 20, total)).toBe(52);
    expect(acceptanceAmount("full", null, total)).toBe(260);
  });

  it("rejects a custom line that has no description and does not invent an inventory link", () => {
    expect(() => prepareLineItems([{ kind: "custom", description: "  ", qty: 1, unitPrice: 10 }], "invoice")).toThrow(/description/);
  });

  it("keeps the CSV shape of existing lines and round-trips a custom line", () => {
    const encodedExisting = encodeLineItemsCell([serviceLine]);
    expect(encodedExisting).toBe("description=Weekly mow|qty=1|unitprice=100|markup=10");
    const custom = {
      id: "c1",
      description: "Equipment Rental",
      qty: 3,
      unitPrice: 20,
      markup: 0,
      discount: 0,
      isOptional: false,
      acceptedByCustomer: true,
      kind: "custom" as const,
      unit: "Day",
      internalCost: 5,
    };
    const errors: string[] = [];
    const decoded = decodeLineItemsCell(encodeLineItemsCell([custom]), errors);
    expect(errors).toEqual([]);
    expect(decoded[0]).toMatchObject({ kind: "custom", description: "Equipment Rental", qty: 3, unitPrice: 20, unit: "Day", internalCost: 5 });
    expect(sumLineItems(decoded)).toBe(60);
  });

  it("stores each attached part once and does not treat that as a stock deduction", () => {
    const [line] = prepareLineItems([{
      kind: "part",
      description: "Supplies for the repair",
      qty: 1,
      unitPrice: 37,
      inventoryItemId: 9,
      components: [
        { inventoryItemId: 4, name: "Valve", quantity: 2, unit: "ea" },
        { inventoryItemId: 4, name: "Valve", quantity: 1, unit: "ea" },
        { inventoryItemId: 8, name: "Elbow", quantity: 4 },
      ],
    }], "estimate");
    expect(line).toMatchObject({
      description: "Supplies for the repair",
      unitPrice: 37,
      inventoryItemId: null,
      components: [
        { inventoryItemId: 4, name: "Valve", quantity: 3, unit: "ea" },
        { inventoryItemId: 8, name: "Elbow", quantity: 4, unit: null },
      ],
    });
    expect(lineExtendedPrice(line as { qty: number; unitPrice: number })).toBe(37);
  });

  it("rejects an attached part that is not an inventory id", () => {
    expect(() => normalizeComponents([{ inventoryItemId: "nope", quantity: 1 }])).toThrow(/inventory item/);
  });

  it("keeps a kit line pointed at the inventory kit and does not copy components onto it", () => {
    const kit = { kind: "kit", description: "Repair kit", qty: 1, unitPrice: 40, inventoryItemId: 12 };
    const [line] = prepareLineItems([kit], "estimate");
    expect(line).toMatchObject({ kind: "kit", inventoryItemId: 12, description: "Repair kit" });
    expect(line).not.toHaveProperty("components");
  });
});
