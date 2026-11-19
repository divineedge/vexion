import { describe, expect, it } from "vitest";
import { suggestMapping } from "./importExport";
import { inventoryImportFields, parseInventoryImportRow } from "./inventoryImport";

describe("inventory CSV import", () => {
  it("suggests a mapping for inventory columns and leaves extra columns unused", () => {
    const mapping = suggestMapping(
      ["Name", "SKU", "Type", "Size", "Category", "Quantity", "Cost", "Sell Price", "Supplier", "Pipe Feet", "Price Per Foot", "Warehouse note"],
      inventoryImportFields,
    );
    expect(mapping).toMatchObject({
      name: "Name",
      sku: "SKU",
      typeName: "Type",
      sizeName: "Size",
      category: "Category",
      quantity: "Quantity",
      unitPrice: "Cost",
      markedUpPrice: "Sell Price",
      supplierName: "Supplier",
      lengthReceived: "Pipe Feet",
      pricePerFoot: "Price Per Foot",
      description: null,
    });
    expect(Object.values(mapping)).not.toContain("Warehouse note");
  });

  it("keeps mapped inventory fields and skips blank cells", () => {
    const parsed = parseInventoryImportRow({
      name: "PVC pipe",
      sku: "PIPE-100",
      typeName: "Pipe",
      sizeName: "1 inch",
      category: "Irrigation",
      quantity: "0",
      unitPrice: "1.25",
      markedUpPrice: "2.50",
      supplierName: "Ewing",
      lengthReceived: "100",
      pricePerFoot: "2.5",
      description: "",
      reorderPoint: "",
      unit: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values).toMatchObject({
      name: "PVC pipe",
      sku: "PIPE-100",
      typeName: "Pipe",
      sizeName: "1 inch",
      category: "Irrigation",
      quantity: 0,
      unitPrice: 1.25,
      markedUpPrice: 2.5,
      supplierName: "Ewing",
      lengthReceived: 100,
      pricePerFoot: 2.5,
    });
    expect(parsed.values).not.toHaveProperty("description");
    expect(parsed.values).not.toHaveProperty("unit");
    expect(parsed.values).not.toHaveProperty("reorderPoint");
  });

  it("keeps a reorder point of 0 instead of treating it as blank", () => {
    const parsed = parseInventoryImportRow({ name: "Stakes", sku: "STK", quantity: "4", reorderPoint: "0" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values.reorderPoint).toBe(0);
  });

  it("rejects a missing SKU and a negative pipe length", () => {
    expect(parseInventoryImportRow({ name: "Elbow", sku: "" }).ok).toBe(false);
    const feet = parseInventoryImportRow({ name: "Pipe", sku: "P-1", lengthReceived: "-3" });
    expect(feet.ok).toBe(false);
    if (!feet.ok) expect(feet.errors.join(" ")).toContain("Pipe Feet");
  });
});
