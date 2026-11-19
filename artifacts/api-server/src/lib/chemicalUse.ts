import { and, eq, inArray } from "drizzle-orm";
import {
  chemicalApplicationsTable,
  chemicalProductsTable,
  db,
  inventoryItemsTable,
  inventoryPartSizesTable,
} from "@workspace/db";
import {
  inventoryStockUnit,
  planInventoryDeductions,
  quantityAfterReplacement,
  readInventoryDeductions,
  roundStock,
  type InventoryDeduction,
  type SprayUsageLine,
} from "./chemicalInventory";

export class ChemicalStockError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChemicalStockError";
    this.status = status;
  }
}

type ApplicationInsert = typeof chemicalApplicationsTable.$inferInsert;

type BreakdownLine = {
  productId?: number;
  productName?: string | null;
  amountApplied?: number;
  unit?: string;
};

function breakdownLines(value: unknown): BreakdownLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is BreakdownLine => !!line && typeof line === "object");
}

async function lockedItems(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: number, ids: number[]) {
  if (!ids.length) return [];
  const items = await tx.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.tenantId, tenantId), inArray(inventoryItemsTable.id, ids)))
    .for("update");
  const sizeIds = items.flatMap(item => item.sizeId == null ? [] : [item.sizeId]);
  const sizes = sizeIds.length
    ? await tx.select({ id: inventoryPartSizesTable.id, name: inventoryPartSizesTable.name })
      .from(inventoryPartSizesTable)
      .where(inArray(inventoryPartSizesTable.id, sizeIds))
    : [];
  const sizeNameById = new Map(sizes.map(size => [size.id, size.name]));
  return items.map(item => ({ item, sizeName: item.sizeId == null ? null : sizeNameById.get(item.sizeId) ?? null }));
}

/**
 * Save a spray application and move inventory once.
 * Editing puts the previous deduction back before applying the new one.
 */
export async function commitChemicalUse(tenantId: number, values: ApplicationInsert, existingId: number | null) {
  return db.transaction(async tx => {
    const previous = existingId == null ? [] : await previousDeductions(tx, tenantId, existingId);
    const lines = breakdownLines(values.breakdown);
    const productIds = [...new Set(lines.map(line => Number(line.productId)).filter(id => Number.isInteger(id) && id > 0))];
    const products = productIds.length
      ? await tx.select().from(chemicalProductsTable).where(and(
        eq(chemicalProductsTable.tenantId, tenantId),
        inArray(chemicalProductsTable.id, productIds),
      ))
      : [];
    const productById = new Map(products.map(product => [product.id, product]));
    const linkedIds = [...new Set([
      ...products.flatMap(product => product.inventoryItemId == null ? [] : [product.inventoryItemId]),
      ...previous.map(deduction => deduction.inventoryItemId),
    ])];
    const locked = await lockedItems(tx, tenantId, linkedIds);
    const itemById = new Map(locked.map(row => [row.item.id, row]));
    const previousByItem = new Map<number, number>();
    for (const deduction of previous) {
      previousByItem.set(deduction.inventoryItemId, roundStock((previousByItem.get(deduction.inventoryItemId) ?? 0) + deduction.quantity));
    }

    const usage: SprayUsageLine[] = [];
    for (const line of lines) {
      const productId = Number(line.productId);
      const amount = Number(line.amountApplied);
      if (!Number.isInteger(productId) || productId <= 0 || !(amount > 0)) continue;
      const product = productById.get(productId);
      if (!product?.inventoryItemId) {
        usage.push({
          productName: product?.name ?? line.productName ?? "Chemical",
          amount,
          unit: line.unit ?? "",
          inventoryItemId: null,
          inventoryName: "",
          inventoryUnit: null,
          onHand: 0,
        });
        continue;
      }
      const linked = itemById.get(product.inventoryItemId);
      if (!linked) throw new ChemicalStockError(`The inventory item linked to ${product.name} was not found.`);
      const available = quantityAfterReplacement(linked.item.quantity, previousByItem.get(linked.item.id) ?? 0, 0);
      usage.push({
        productName: product.name,
        amount,
        unit: line.unit ?? "",
        inventoryItemId: linked.item.id,
        inventoryName: linked.item.name,
        inventoryUnit: inventoryStockUnit(linked.sizeName, linked.item.unit),
        onHand: available,
      });
    }

    const plan = planInventoryDeductions(usage);
    if (!plan.ok) throw new ChemicalStockError(plan.message);

    const stored: InventoryDeduction[] = plan.deductions;
    const writing = { ...values, tenantId, inventoryDeductions: stored };
    const [saved] = existingId == null
      ? await tx.insert(chemicalApplicationsTable).values(writing).returning()
      : await tx.update(chemicalApplicationsTable).set(writing).where(and(
        eq(chemicalApplicationsTable.id, existingId),
        eq(chemicalApplicationsTable.tenantId, tenantId),
      )).returning();
    if (!saved) throw new ChemicalStockError("Application not found", 404);

    const nextByItem = new Map(stored.map(deduction => [deduction.inventoryItemId, deduction.quantity]));
    for (const itemId of new Set([...previousByItem.keys(), ...nextByItem.keys()])) {
      const linked = itemById.get(itemId);
      if (!linked) {
        if ((nextByItem.get(itemId) ?? 0) > 0) throw new ChemicalStockError("Linked inventory item was not found.");
        continue;
      }
      const next = quantityAfterReplacement(linked.item.quantity, previousByItem.get(itemId) ?? 0, nextByItem.get(itemId) ?? 0);
      if (next < -1e-9) throw new ChemicalStockError(`Not enough ${linked.item.name} in inventory.`);
      await tx.update(inventoryItemsTable).set({
        quantity: next,
        isLowStock: next <= linked.item.reorderPoint,
      }).where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)));
    }
    return saved;
  });
}

async function previousDeductions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: number,
  existingId: number,
) {
  const [existing] = await tx.select().from(chemicalApplicationsTable).where(and(
    eq(chemicalApplicationsTable.id, existingId),
    eq(chemicalApplicationsTable.tenantId, tenantId),
  )).for("update");
  if (!existing) throw new ChemicalStockError("Application not found", 404);
  return readInventoryDeductions(existing.inventoryDeductions);
}

export async function deleteChemicalUse(tenantId: number, id: number): Promise<boolean> {
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(chemicalApplicationsTable).where(and(
      eq(chemicalApplicationsTable.id, id),
      eq(chemicalApplicationsTable.tenantId, tenantId),
    )).for("update");
    if (!existing) return false;
    const previous = readInventoryDeductions(existing.inventoryDeductions);
    const locked = await lockedItems(tx, tenantId, previous.map(deduction => deduction.inventoryItemId));
    const itemById = new Map(locked.map(row => [row.item.id, row.item]));
    for (const deduction of previous) {
      const item = itemById.get(deduction.inventoryItemId);
      if (!item) continue;
      const next = quantityAfterReplacement(item.quantity, deduction.quantity, 0);
      item.quantity = next;
      await tx.update(inventoryItemsTable).set({
        quantity: next,
        isLowStock: next <= item.reorderPoint,
      }).where(and(eq(inventoryItemsTable.id, item.id), eq(inventoryItemsTable.tenantId, tenantId)));
    }
    await tx.delete(chemicalApplicationsTable).where(and(
      eq(chemicalApplicationsTable.id, id),
      eq(chemicalApplicationsTable.tenantId, tenantId),
    ));
    return true;
  });
}
