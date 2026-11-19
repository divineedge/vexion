import { describe, expect, it } from "vitest";
import {
  applyQuantityDelta,
  planDuplicates,
  presentQuantity,
  stockOwnerId,
  type DuplicableItem,
} from "./inventoryDuplicate";

function item(overrides: Partial<DuplicableItem> & Pick<DuplicableItem, "id" | "name" | "sku">): DuplicableItem {
  return {
    stockItemId: null,
    description: "Schedule 40",
    category: "Irrigation",
    typeId: 1,
    sizeId: 2,
    unitPrice: 10,
    markedUpPrice: 12,
    quantity: 8,
    reorderPoint: 5,
    unit: "each",
    availableForBlueprint: false,
    commissionPct: 4,
    supplierId: 3,
    lengthReceived: null,
    pricePerFoot: null,
    vendorId: 9,
    ...overrides,
  };
}

type Row = DuplicableItem & { id: number };

function storedOnHand(rows: readonly Row[]): number {
  return rows.reduce((sum, row) => sum + (row.stockItemId == null ? row.quantity : 0), 0);
}

function shown(rows: readonly Row[], id: number): number {
  const row = rows.find(entry => entry.id === id);
  if (!row) throw new Error(`missing ${id}`);
  const owner = rows.find(entry => entry.id === stockOwnerId(row));
  return presentQuantity(row, owner?.quantity);
}

function duplicate(rows: Row[], ids: number[]): Row[] {
  const planned = planDuplicates(rows, ids, rows.map(row => row.sku));
  if (!planned.ok) throw new Error(planned.error);
  let nextId = Math.max(...rows.map(row => row.id)) + 1;
  const created = planned.copies.map(copy => {
    const row: Row = { ...copy, id: nextId, quantity: 0 };
    nextId += 1;
    rows.push(row);
    return row;
  });
  return created;
}

function adjust(rows: Row[], id: number, delta: number): number {
  const row = rows.find(entry => entry.id === id);
  if (!row) throw new Error(`missing ${id}`);
  const owner = rows.find(entry => entry.id === stockOwnerId(row));
  if (!owner) throw new Error("missing stock owner");
  const next = applyQuantityDelta(owner.quantity, delta);
  if (!next.ok) throw new Error(next.error);
  owner.quantity = next.quantity;
  return next.quantity;
}

describe("inventory duplicate", () => {
  const pipe = item({
    id: 1,
    name: "PVC pipe",
    sku: "PVC-1",
    typeId: 4,
    sizeId: 7,
    unitPrice: 2.5,
    markedUpPrice: 2.5,
    quantity: 40,
    unit: "ft",
    lengthReceived: 40,
    pricePerFoot: 2.5,
    description: "Sold by the foot",
  });
  const fitting = item({
    id: 2,
    name: "Elbow",
    sku: "ELB-1",
    typeId: 5,
    sizeId: 8,
    unitPrice: 10,
    markedUpPrice: 15,
    quantity: 6,
    unit: "each",
    category: "Fittings",
    pricePerFoot: null,
    lengthReceived: null,
  });

  it("copies catalog fields onto a new item with a unique SKU and the same stock pile", () => {
    const rows = [pipe, fitting];
    const before = storedOnHand(rows);
    const [copy] = duplicate(rows, [pipe.id]);

    expect(copy.id).not.toBe(pipe.id);
    expect(copy.sku).not.toBe(pipe.sku);
    expect(copy.sku).toBe("PVC-1-COPY");
    expect(copy.name).toBe("PVC pipe copy");
    expect(copy).toMatchObject({
      stockItemId: pipe.id,
      typeId: pipe.typeId,
      sizeId: pipe.sizeId,
      category: pipe.category,
      unitPrice: pipe.unitPrice,
      markedUpPrice: pipe.markedUpPrice,
      supplierId: pipe.supplierId,
      vendorId: pipe.vendorId,
      lengthReceived: pipe.lengthReceived,
      pricePerFoot: pipe.pricePerFoot,
      unit: "ft",
      description: pipe.description,
      quantity: 0,
    });
    expect(shown(rows, copy.id)).toBe(40);
    expect(shown(rows, pipe.id)).toBe(40);
    expect(storedOnHand(rows)).toBe(before);
  });

  it("keeps one quantity when the copy or the original is adjusted", () => {
    const rows = [structuredClone(pipe), structuredClone(fitting)];
    const [copy] = duplicate(rows, [pipe.id]);

    adjust(rows, copy.id, -5);
    expect(shown(rows, pipe.id)).toBe(35);
    expect(shown(rows, copy.id)).toBe(35);
    expect(storedOnHand(rows)).toBe(35 + fitting.quantity);

    adjust(rows, pipe.id, 2);
    expect(shown(rows, copy.id)).toBe(37);
    expect(shown(rows, pipe.id)).toBe(37);
    expect(rows.find(row => row.id === copy.id)?.quantity).toBe(0);
  });

  it("mass-duplicates each item onto that item's stock, and a copy of a copy stays on the same pile", () => {
    const rows = [structuredClone(pipe), structuredClone(fitting)];
    const before = storedOnHand(rows);
    const created = duplicate(rows, [pipe.id, fitting.id]);

    expect(created).toHaveLength(2);
    expect(new Set(created.map(row => row.sku)).size).toBe(2);
    expect(created.map(row => row.stockItemId)).toEqual([pipe.id, fitting.id]);
    expect(shown(rows, created[0].id)).toBe(pipe.quantity);
    expect(shown(rows, created[1].id)).toBe(fitting.quantity);
    expect(storedOnHand(rows)).toBe(before);

    const [again] = duplicate(rows, [created[0].id]);
    expect(again.stockItemId).toBe(pipe.id);
    expect(again.sku).toBe("PVC-1-COPY-COPY");
    expect(again.name).toBe("PVC pipe copy copy");
    adjust(rows, again.id, -1);
    expect(shown(rows, pipe.id)).toBe(pipe.quantity - 1);
    expect(shown(rows, created[0].id)).toBe(pipe.quantity - 1);
    expect(shown(rows, again.id)).toBe(pipe.quantity - 1);
    expect(shown(rows, fitting.id)).toBe(fitting.quantity);
  });
});
