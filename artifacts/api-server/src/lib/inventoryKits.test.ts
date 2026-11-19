import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  kitJobLine,
  onHandNeeded,
  parseLinkedPartsBody,
  planLinkedUse,
  type UseLineInput,
} from "./inventoryKits";
import { parseReorderPoint, stockNeedsReorder } from "./reorderPoint";

function line(partial: Partial<UseLineInput> & Pick<UseLineInput, "inventoryItemId" | "name" | "unit" | "onHand" | "sellPrice">): UseLineInput {
  return {
    legacyQuantity: 0,
    tracked: 0,
    ...partial,
  };
}

function commit(stock: Map<number, UseLineInput>, usedQuantity: number, kit: { parentQuantity: number; components: { inventoryItemId: number; quantity: number }[] } | null) {
  const parent = stock.get([...stock.keys()][0]);
  if (!parent) throw new Error("missing parent");
  const components = [...stock.values()].filter(row => row.inventoryItemId !== parent.inventoryItemId);
  const plan = planLinkedUse({ usedQuantity, parent, kit, components });
  if (!plan.ok) return plan;
  for (const planned of plan.lines) {
    const row = stock.get(planned.inventoryItemId);
    if (!row) throw new Error(`missing ${planned.name}`);
    const needed = onHandNeeded(planned.quantity, row.legacyQuantity, row.tracked);
    if (needed > row.onHand) throw new Error(`short ${row.name}`);
    row.onHand -= needed;
    row.legacyQuantity = Math.min(row.legacyQuantity, planned.quantity);
    row.tracked = planned.quantity - row.legacyQuantity;
  }
  return plan;
}

describe("reorder point of 0", () => {
  it("saves 0 as a real threshold and treats a blank as missing", () => {
    expect(parseReorderPoint(0)).toBe(0);
    expect(parseReorderPoint("0")).toBe(0);
    expect(parseReorderPoint("")).toBe(5);
    expect(parseReorderPoint(undefined)).toBe(5);
    expect(parseReorderPoint(null)).toBe(5);
    expect(parseReorderPoint(-1)).toBe("invalid");
    expect(stockNeedsReorder(0, 0)).toBe(true);
    expect(stockNeedsReorder(1, 0)).toBe(false);
  });
});

describe("fabric and stake ratio", () => {
  it("uses 10 stakes for 100 sq ft, 5 for 50, and 20 for 200, once", () => {
    const fabric = line({ inventoryItemId: 1, name: "Weed barrier fabric", unit: "sq ft", onHand: 1000, sellPrice: 1.25 });
    const stakes = line({ inventoryItemId: 2, name: "Stakes", unit: "each", onHand: 100, sellPrice: 0.4 });
    const stock = new Map<number, UseLineInput>([[fabric.inventoryItemId, fabric], [stakes.inventoryItemId, stakes]]);
    const kit = { parentQuantity: 100, components: [{ inventoryItemId: 2, quantity: 10 }, { inventoryItemId: 2, quantity: 10 }] };

    const first = commit(stock, 100, kit);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lines.map(entry => [entry.name, entry.quantity, entry.unit])).toEqual([
      ["Weed barrier fabric", 100, "sq ft"],
      ["Stakes", 10, "each"],
    ]);
    expect(first.combinedPrice).toBe(129);
    expect(kitJobLine(100, first.combinedPrice)).toEqual({ quantity: 100, unitPrice: 1.29, total: 129 });
    expect(fabric.onHand).toBe(900);
    expect(stakes.onHand).toBe(90);

    const again = commit(stock, 100, kit);
    expect(again.ok).toBe(true);
    expect(fabric.onHand).toBe(900);
    expect(stakes.onHand).toBe(90);

    const half = commit(stock, 50, kit);
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.lines.find(entry => entry.name === "Stakes")?.quantity).toBe(5);
    expect(half.combinedPrice).toBe(64.5);
    expect(fabric.onHand).toBe(950);
    expect(stakes.onHand).toBe(95);

    const doubled = commit(stock, 200, kit);
    expect(doubled.ok).toBe(true);
    if (!doubled.ok) return;
    expect(doubled.lines.find(entry => entry.name === "Stakes")?.quantity).toBe(20);
    expect(doubled.combinedPrice).toBe(258);
    expect(fabric.onHand).toBe(800);
    expect(stakes.onHand).toBe(80);

    const removed = commit(stock, 0, kit);
    expect(removed.ok).toBe(true);
    expect(fabric.onHand).toBe(1000);
    expect(stakes.onHand).toBe(100);
  });

  it("names the short part and does not deduct the others", () => {
    const fabric = line({ inventoryItemId: 1, name: "Weed barrier fabric", unit: "sq ft", onHand: 1000, sellPrice: 1.25 });
    const stakes = line({ inventoryItemId: 2, name: "Stakes", unit: "each", onHand: 4, sellPrice: 0.4 });
    const plan = planLinkedUse({
      usedQuantity: 100,
      parent: fabric,
      kit: { parentQuantity: 100, components: [{ inventoryItemId: 2, quantity: 10 }] },
      components: [stakes],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain("Not enough stock");
    expect(plan.message).toContain("Stakes");
    expect(fabric.onHand).toBe(1000);
    expect(stakes.onHand).toBe(4);
  });
});

describe("valve kit", () => {
  it("deducts each fitting and a pound chemical once, and exposes one combined price", () => {
    const valve = line({ inventoryItemId: 1, name: "Valve", unit: "each", onHand: 8, sellPrice: 40 });
    const elbow = line({ inventoryItemId: 2, name: "Elbow", unit: "each", onHand: 10, sellPrice: 2.5 });
    const coupling = line({ inventoryItemId: 3, name: "Coupling", unit: "each", onHand: 6, sellPrice: 3.25 });
    const chemical = line({ inventoryItemId: 4, name: "Pre-emergent", unit: "lb", onHand: 5, sellPrice: 8 });
    const gallons = line({ inventoryItemId: 5, name: "Gallon chemical", unit: "gal", onHand: 9, sellPrice: 12 });
    const stock = new Map<number, UseLineInput>([
      [valve.inventoryItemId, valve],
      [elbow.inventoryItemId, elbow],
      [coupling.inventoryItemId, coupling],
      [chemical.inventoryItemId, chemical],
      [gallons.inventoryItemId, gallons],
    ]);
    const kit = {
      parentQuantity: 1,
      components: [
        { inventoryItemId: valve.inventoryItemId, quantity: 1 },
        { inventoryItemId: elbow.inventoryItemId, quantity: 2 },
        { inventoryItemId: coupling.inventoryItemId, quantity: 1 },
        { inventoryItemId: chemical.inventoryItemId, quantity: 2 },
      ],
    };

    const once = commit(stock, 1, kit);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(once.lines.map(entry => [entry.inventoryItemId, entry.quantity, entry.unit])).toEqual([
      [1, 1, "each"],
      [2, 2, "each"],
      [3, 1, "each"],
      [4, 2, "lb"],
    ]);
    expect(once.lines.some(entry => entry.unit === "gal")).toBe(false);
    expect(once.combinedPrice).toBe(64.25);
    expect(kitJobLine(1, once.combinedPrice)).toEqual({ quantity: 1, unitPrice: 64.25, total: 64.25 });
    expect(valve.onHand).toBe(7);
    expect(elbow.onHand).toBe(8);
    expect(coupling.onHand).toBe(5);
    expect(chemical.onHand).toBe(3);
    expect(gallons.onHand).toBe(9);

    commit(stock, 1, kit);
    expect(valve.onHand).toBe(7);
    expect(elbow.onHand).toBe(8);
    expect(coupling.onHand).toBe(5);
    expect(chemical.onHand).toBe(3);

    const two = commit(stock, 2, kit);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.combinedPrice).toBe(128.5);
    expect(kitJobLine(2, two.combinedPrice).total).toBe(128.5);
    expect(valve.onHand).toBe(6);
    expect(elbow.onHand).toBe(6);
    expect(coupling.onHand).toBe(4);
    expect(chemical.onHand).toBe(1);
    expect(gallons.onHand).toBe(9);

    commit(stock, 0, kit);
    expect(valve.onHand).toBe(8);
    expect(elbow.onHand).toBe(10);
    expect(coupling.onHand).toBe(6);
    expect(chemical.onHand).toBe(5);
    expect(gallons.onHand).toBe(9);
  });

  it("names a short fitting and leaves every count unchanged", () => {
    const valve = line({ inventoryItemId: 1, name: "Valve", unit: "each", onHand: 8, sellPrice: 40 });
    const elbow = line({ inventoryItemId: 2, name: "Elbow", unit: "each", onHand: 1, sellPrice: 2.5 });
    const coupling = line({ inventoryItemId: 3, name: "Coupling", unit: "each", onHand: 6, sellPrice: 3.25 });
    const plan = planLinkedUse({
      usedQuantity: 1,
      parent: valve,
      kit: {
        parentQuantity: 1,
        components: [
          { inventoryItemId: 2, quantity: 2 },
          { inventoryItemId: 3, quantity: 1 },
        ],
      },
      components: [elbow, coupling],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain("Not enough stock for Elbow");
    expect(plan.message).not.toContain("Coupling");
    expect(valve.onHand).toBe(8);
    expect(elbow.onHand).toBe(1);
    expect(coupling.onHand).toBe(6);
  });
});

describe("linked part payload", () => {
  it("accepts the fabric ratio and rejects a zero quantity", () => {
    expect(parseLinkedPartsBody({
      quantity: 100,
      components: [{ inventoryItemId: 2, quantity: 10 }],
    })).toEqual({ ok: true, value: { quantity: 100, components: [{ inventoryItemId: 2, quantity: 10 }] } });
    expect(parseLinkedPartsBody(null)).toEqual({ ok: true, value: null });
    const zero = parseLinkedPartsBody({ quantity: 0, components: [{ inventoryItemId: 2, quantity: 10 }] });
    expect(zero.ok).toBe(false);
  });
});

describe("job part wiring", () => {
  it("plans the linked use before stock changes and keeps the chemical unit conversion file untouched by this planner", () => {
    const costing = readFileSync(new URL("./inventoryCosting.ts", import.meta.url), "utf8");
    const body = costing.slice(costing.indexOf("export async function setJobPart"));
    expect(body.indexOf("planLinkedUse")).toBeGreaterThan(0);
    expect(body.indexOf("applyDesiredQuantity")).toBeGreaterThan(body.indexOf("planLinkedUse"));
    expect(body).toContain("if(plan.ok===false)fail(plan.message)");
    expect(body).toContain("kitJobLine");
    expect(readFileSync(new URL("./chemicalInventory.ts", import.meta.url), "utf8")).toContain("Pounds stay pounds");
  });
});
