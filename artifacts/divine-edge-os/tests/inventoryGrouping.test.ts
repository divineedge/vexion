import { describe, expect, it } from "vitest";
import {
  NO_SIZE_LABEL,
  NO_TYPE_LABEL,
  groupInventoryItems,
  sizeIdForType,
  sizesForType,
  type InventorySizeOption,
} from "../src/lib/inventoryGrouping";

const sizes: InventorySizeOption[] = [
  { id: 1, typeId: 10, name: '1"' },
  { id: 2, typeId: 10, name: '2"' },
  { id: 3, typeId: 20, name: "elbow" },
];

const items = [
  { id: 1, name: "PVC pipe", typeId: 10, typeName: "Pipe", sizeId: 1, sizeName: '1"' },
  { id: 2, name: "PVC pipe large", typeId: 10, typeName: "Pipe", sizeId: 2, sizeName: '2"' },
  { id: 3, name: "90 elbow", typeId: 20, typeName: "Fitting", sizeId: 3, sizeName: "elbow" },
  { id: 4, name: "Loose washer", typeId: null, typeName: null, sizeId: null, sizeName: null },
];

describe("sizesForType", () => {
  it("returns only sizes that belong to the chosen type", () => {
    expect(sizesForType(sizes, 10).map(size => size.name)).toEqual(['1"', '2"']);
    expect(sizesForType(sizes, 20).map(size => size.name)).toEqual(["elbow"]);
  });

  it("returns no sizes until a type is chosen", () => {
    expect(sizesForType(sizes, null)).toEqual([]);
  });

  it("drops a size that does not belong to the newly chosen type", () => {
    expect(sizeIdForType(3, 10, sizes)).toBeNull();
    expect(sizeIdForType(1, 10, sizes)).toBe(1);
    expect(sizeIdForType(1, null, sizes)).toBeNull();
  });
});

describe("groupInventoryItems", () => {
  it("organizes parts under their type and keeps untyped parts", () => {
    const groups = groupInventoryItems(items, "type");
    expect(groups.map(group => group.label)).toEqual(["Fitting", "Pipe", NO_TYPE_LABEL]);
    expect(groups.find(group => group.label === "Pipe")?.items.map(item => item.name)).toEqual([
      "PVC pipe",
      "PVC pipe large",
    ]);
    expect(groups.find(group => group.key === "unassigned")?.items.map(item => item.id)).toEqual([4]);
  });

  it("organizes parts under their size and keeps parts with no size", () => {
    const groups = groupInventoryItems(items, "size");
    expect(groups.map(group => group.label)).toEqual(['1" · Pipe', '2" · Pipe', "elbow · Fitting", NO_SIZE_LABEL]);
    expect(groups.find(group => group.label === "elbow · Fitting")?.items.map(item => item.name)).toEqual(["90 elbow"]);
    expect(groups.at(-1)?.items.map(item => item.name)).toEqual(["Loose washer"]);
  });
});
