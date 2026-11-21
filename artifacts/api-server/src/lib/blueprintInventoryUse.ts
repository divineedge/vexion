import { and, eq } from "drizzle-orm";
import {
  blueprintInventoryUsesTable,
  blueprintsTable,
  db,
  inventoryItemsTable,
  inventoryPartSizesTable,
} from "@workspace/db";
import {
  inventoryStockUnit,
  parseAreaUnit,
  parseLengthUnit,
  parseStockUnit,
  planInventoryDeductions,
  quantityAfterReplacement,
  remainingMeasureLabel,
  type SizeCoverage,
  type SizeLength,
  type SizeVolume,
  type SprayUsageLine,
} from "./chemicalInventory";
import { stockOwnerId } from "./inventoryDuplicate";
import { stockNeedsReorder } from "./reorderPoint";

export class MeasuredStockError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MeasuredStockError";
    this.status = status;
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type StockRow = {
  id: number;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  reorderPoint: number;
  stockAlerts: boolean;
  stockItemId: number | null;
  pricePerFoot: number | null;
  sizeName: string | null;
  sizeVolume: SizeVolume | null;
  sizeCoverage: SizeCoverage | null;
  sizeLength: SizeLength | null;
};

export type MeasuredUseView = {
  id: number;
  blueprintId: number;
  inventoryItemId: number;
  name: string;
  sku: string;
  amount: number;
  unit: string;
  onHand: number;
  measure: string;
  remainingLabel: string;
  elementId: string | null;
};

function sizeVolume(amount: number | null, unit: string | null): SizeVolume | null {
  if (amount == null || !(amount > 0) || !parseStockUnit(unit)) return null;
  return { amount, unit: unit ?? "" };
}

function sizeCoverage(amount: number | null, unit: string | null): SizeCoverage | null {
  if (amount == null || !(amount > 0) || parseAreaUnit(unit)?.canonical !== "sqft") return null;
  return { amount, unit: "sqft" };
}

function sizeLength(amount: number | null, unit: string | null): SizeLength | null {
  if (amount == null || !(amount > 0) || !parseLengthUnit(unit)) return null;
  return { amount, unit: unit ?? "" };
}

async function loadStock(tx: Tx, tenantId: number, itemId: number): Promise<StockRow | null> {
  const [item] = await tx.select().from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.tenantId, tenantId)))
    .for("update");
  if (!item) return null;
  const [size] = item.sizeId == null ? [] : await tx.select().from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, item.sizeId), eq(inventoryPartSizesTable.tenantId, tenantId)));
  const length = sizeLength(size?.lengthAmount ?? null, size?.lengthUnit ?? null);
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    quantity: item.quantity,
    reorderPoint: item.reorderPoint,
    stockAlerts: item.stockAlerts,
    stockItemId: item.stockItemId,
    pricePerFoot: item.pricePerFoot,
    sizeName: size?.name ?? null,
    sizeVolume: sizeVolume(size?.volumeAmount ?? null, size?.volumeUnit ?? null),
    sizeCoverage: sizeCoverage(size?.coverageAmount ?? null, size?.coverageUnit ?? null),
    sizeLength: length,
  };
}

async function lockOwner(tx: Tx, tenantId: number, item: StockRow): Promise<StockRow> {
  const ownerId = stockOwnerId(item);
  if (ownerId === item.id) return item;
  const owner = await loadStock(tx, tenantId, ownerId);
  if (!owner) throw new MeasuredStockError("The shared inventory item was not found.");
  return owner;
}

function viewFor(
  use: typeof blueprintInventoryUsesTable.$inferSelect,
  item: { name: string; sku: string; quantity: number },
): MeasuredUseView {
  return {
    id: use.id,
    blueprintId: use.blueprintId,
    inventoryItemId: use.inventoryItemId,
    name: item.name,
    sku: item.sku,
    amount: use.amount,
    unit: use.unit,
    onHand: item.quantity,
    measure: use.deductedUnit,
    remainingLabel: remainingMeasureLabel(item.quantity, use.deductedUnit),
    elementId: use.elementId,
  };
}

export async function listBlueprintInventoryUses(tenantId: number, blueprintId: number): Promise<MeasuredUseView[] | null> {
  const [blueprint] = await db.select({ id: blueprintsTable.id }).from(blueprintsTable)
    .where(and(eq(blueprintsTable.id, blueprintId), eq(blueprintsTable.tenantId, tenantId)));
  if (!blueprint) return null;
  const uses = await db.select().from(blueprintInventoryUsesTable)
    .where(and(eq(blueprintInventoryUsesTable.tenantId, tenantId), eq(blueprintInventoryUsesTable.blueprintId, blueprintId)))
    .orderBy(blueprintInventoryUsesTable.id);
  const views: MeasuredUseView[] = [];
  for (const use of uses) {
    const [item] = await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, use.inventoryItemId), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!item) continue;
    const ownerId = stockOwnerId(item);
    const owner = ownerId === item.id
      ? item
      : (await db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.tenantId, tenantId))))[0];
    views.push(viewFor(use, { name: item.name, sku: item.sku, quantity: owner?.quantity ?? item.quantity }));
  }
  return views;
}

async function applyUse(
  tx: Tx,
  tenantId: number,
  blueprintId: number,
  input: { inventoryItemId: number; amount: number; unit?: string | null; elementId?: string | null },
  existingId: number | null,
) {
  const [blueprint] = await tx.select({ id: blueprintsTable.id }).from(blueprintsTable)
    .where(and(eq(blueprintsTable.id, blueprintId), eq(blueprintsTable.tenantId, tenantId)))
    .for("update");
  if (!blueprint) throw new MeasuredStockError("Blueprint not found", 404);

  let useId = existingId;
  if (useId == null && input.elementId) {
    const [placed] = await tx.select().from(blueprintInventoryUsesTable).where(and(
      eq(blueprintInventoryUsesTable.tenantId, tenantId),
      eq(blueprintInventoryUsesTable.blueprintId, blueprintId),
      eq(blueprintInventoryUsesTable.elementId, input.elementId),
    )).for("update");
    useId = placed?.id ?? null;
  }

  const [previous] = useId == null ? [] : await tx.select().from(blueprintInventoryUsesTable).where(and(
    eq(blueprintInventoryUsesTable.id, useId),
    eq(blueprintInventoryUsesTable.tenantId, tenantId),
    eq(blueprintInventoryUsesTable.blueprintId, blueprintId),
  )).for("update");
  if (useId != null && !previous) throw new MeasuredStockError("Inventory use not found", 404);

  const requested = await loadStock(tx, tenantId, input.inventoryItemId);
  if (!requested) throw new MeasuredStockError("Inventory item not found.");
  if (previous && previous.inventoryItemId !== requested.id) {
    throw new MeasuredStockError("Remove this use before choosing a different item.");
  }
  const owner = await lockOwner(tx, tenantId, requested);
  const stockUnit = inventoryStockUnit(requested.sizeName, requested.unit, {
    pricePerFoot: requested.pricePerFoot,
    lengthUnit: requested.sizeLength?.unit ?? null,
  });
  if (!stockUnit) {
    throw new MeasuredStockError("This item is counted by the piece. Enter square feet, gallons, ounces, pounds, feet, or inches.");
  }
  const useUnit = (input.unit ?? "").trim() || stockUnit;
  const available = quantityAfterReplacement(owner.quantity, previous?.deductedQuantity ?? 0, 0);
  const usage: SprayUsageLine = {
    productName: requested.name,
    amount: input.amount,
    unit: useUnit,
    inventoryItemId: owner.id,
    inventoryName: requested.name,
    inventoryUnit: stockUnit,
    onHand: available,
    sizeVolume: requested.sizeVolume,
    sizeCoverage: requested.sizeCoverage,
    sizeLength: requested.sizeLength,
  };
  const plan = planInventoryDeductions([usage], "use");
  if (!plan.ok) throw new MeasuredStockError(plan.message);
  const deduction = plan.deductions[0];
  if (!deduction) throw new MeasuredStockError("Enter an amount greater than 0.");
  const nextQuantity = quantityAfterReplacement(owner.quantity, previous?.deductedQuantity ?? 0, deduction.quantity);
  if (nextQuantity < -1e-9) throw new MeasuredStockError(`Not enough ${requested.name} in inventory.`);

  await tx.update(inventoryItemsTable).set({
    quantity: nextQuantity,
    isLowStock: stockNeedsReorder(nextQuantity, owner.reorderPoint, owner.stockAlerts),
  }).where(and(eq(inventoryItemsTable.id, owner.id), eq(inventoryItemsTable.tenantId, tenantId)));

  const writing = {
    tenantId,
    blueprintId,
    inventoryItemId: requested.id,
    amount: input.amount,
    unit: useUnit,
    deductedQuantity: deduction.quantity,
    deductedUnit: deduction.unit,
    elementId: input.elementId ?? previous?.elementId ?? null,
  };
  const [saved] = previous
    ? await tx.update(blueprintInventoryUsesTable).set(writing).where(eq(blueprintInventoryUsesTable.id, previous.id)).returning()
    : await tx.insert(blueprintInventoryUsesTable).values(writing).returning();
  return viewFor(saved, { name: requested.name, sku: requested.sku, quantity: nextQuantity });
}

export async function saveBlueprintInventoryUse(
  tenantId: number,
  blueprintId: number,
  input: { inventoryItemId: number; amount: number; unit?: string | null; elementId?: string | null },
  existingId: number | null,
) {
  if (!Number.isInteger(input.inventoryItemId) || input.inventoryItemId <= 0) {
    throw new MeasuredStockError("Choose an inventory item.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new MeasuredStockError("Enter an amount greater than 0.");
  }
  return db.transaction(tx => applyUse(tx, tenantId, blueprintId, input, existingId));
}

async function restoreUse(tx: Tx, tenantId: number, use: typeof blueprintInventoryUsesTable.$inferSelect) {
  const requested = await loadStock(tx, tenantId, use.inventoryItemId);
  if (!requested) return;
  const owner = await lockOwner(tx, tenantId, requested);
  const nextQuantity = quantityAfterReplacement(owner.quantity, use.deductedQuantity, 0);
  await tx.update(inventoryItemsTable).set({
    quantity: nextQuantity,
    isLowStock: stockNeedsReorder(nextQuantity, owner.reorderPoint, owner.stockAlerts),
  }).where(and(eq(inventoryItemsTable.id, owner.id), eq(inventoryItemsTable.tenantId, tenantId)));
}

export async function deleteBlueprintInventoryUse(tenantId: number, blueprintId: number, useId: number): Promise<boolean> {
  return db.transaction(async tx => {
    const [use] = await tx.select().from(blueprintInventoryUsesTable).where(and(
      eq(blueprintInventoryUsesTable.id, useId),
      eq(blueprintInventoryUsesTable.tenantId, tenantId),
      eq(blueprintInventoryUsesTable.blueprintId, blueprintId),
    )).for("update");
    if (!use) return false;
    await restoreUse(tx, tenantId, use);
    await tx.delete(blueprintInventoryUsesTable).where(eq(blueprintInventoryUsesTable.id, use.id));
    return true;
  });
}

/** Put every measured use back before the blueprint itself is removed. */
export async function releaseBlueprintInventoryUses(tenantId: number, blueprintId: number) {
  await db.transaction(async tx => {
    const uses = await tx.select().from(blueprintInventoryUsesTable).where(and(
      eq(blueprintInventoryUsesTable.tenantId, tenantId),
      eq(blueprintInventoryUsesTable.blueprintId, blueprintId),
    )).for("update");
    for (const use of uses) await restoreUse(tx, tenantId, use);
    await tx.delete(blueprintInventoryUsesTable).where(and(
      eq(blueprintInventoryUsesTable.tenantId, tenantId),
      eq(blueprintInventoryUsesTable.blueprintId, blueprintId),
    ));
  });
}
