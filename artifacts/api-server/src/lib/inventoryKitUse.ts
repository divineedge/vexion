import { and, eq, inArray } from "drizzle-orm";
import { inventoryItemsTable } from "@workspace/db";
import type { HrDb } from "./hrAccess";
import { installInventoryKitSchema } from "./inventoryKitSchema";
import { formatKitAmount, inventoryUseKeys, kitComponentTargets, selectRecordedUse } from "./inventoryKits";
import { readKitRatio, readKitUses, saveKitUse } from "./inventoryKitStore";
import { stockOwnerId } from "./inventoryDuplicate";
import { stockNeedsReorder } from "./reorderPoint";

type ComponentUse = { inventoryItemId: number; quantity: number };

function componentUses(value: unknown): ComponentUse[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { inventoryItemId?: unknown; quantity?: unknown };
    const inventoryItemId = Number(row.inventoryItemId);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0 || !Number.isFinite(quantity) || quantity < 0) return [];
    return [{ inventoryItemId, quantity }];
  });
}

/**
 * When a chemical application uses a kit, deduct each component as well.
 * The application is one use: editing it replaces the component quantities.
 * The parent item stays on the chemical deduction. A short component names that part and changes nothing.
 */
export async function syncChemicalKitComponents(
  tx: HrDb,
  tenantId: number,
  applicationId: number,
  deductions: readonly { inventoryItemId: number; quantity: number }[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  await installInventoryKitSchema();
  const wanted = new Map<number, number>();
  for (const deduction of deductions) {
    if (!Number.isInteger(deduction.inventoryItemId) || deduction.inventoryItemId <= 0) continue;
    wanted.set(deduction.inventoryItemId, Math.max(0, deduction.quantity));
  }
  const identities = [...wanted.keys()].map(itemId => ({
    itemId,
    keys: inventoryUseKeys({ itemId, chemicalApplicationId: applicationId }),
  }));
  const recorded = await readKitUses(tx, tenantId, identities.flatMap(entry => entry.keys.matchKeys));

  const previousByComponent = new Map<number, number>();
  const nextByComponent = new Map<number, number>();
  const nextByParent = new Map<number, ComponentUse[]>();

  for (const { itemId, keys } of identities) {
    const previous = selectRecordedUse(recorded, keys.matchKeys);
    for (const component of componentUses(previous?.kitUsage)) {
      previousByComponent.set(component.inventoryItemId, (previousByComponent.get(component.inventoryItemId) ?? 0) + component.quantity);
    }
    const units = wanted.get(itemId) ?? 0;
    const kit = units > 0 ? await readKitRatio(tx, tenantId, itemId) : null;
    const targets = kitComponentTargets(kit, units, itemId);
    nextByParent.set(itemId, targets);
    for (const target of targets) {
      nextByComponent.set(target.inventoryItemId, (nextByComponent.get(target.inventoryItemId) ?? 0) + target.quantity);
    }
  }

  const componentIds = [...new Set([...previousByComponent.keys(), ...nextByComponent.keys()])];
  if (componentIds.length === 0) return { ok: true };

  const rows = await tx.select().from(inventoryItemsTable).where(and(
    eq(inventoryItemsTable.tenantId, tenantId),
    inArray(inventoryItemsTable.id, componentIds),
  )).for("update");
  const byId = new Map(rows.map(row => [row.id, row]));
  const ownerIds = [...new Set(rows.map(stockOwnerId))].filter(id => !byId.has(id));
  if (ownerIds.length) {
    const owners = await tx.select().from(inventoryItemsTable).where(and(
      eq(inventoryItemsTable.tenantId, tenantId),
      inArray(inventoryItemsTable.id, ownerIds),
    )).for("update");
    for (const owner of owners) byId.set(owner.id, owner);
  }

  const deltaByOwner = new Map<number, { name: string; unit: string; delta: number }>();
  for (const componentId of componentIds) {
    const row = byId.get(componentId);
    const previous = previousByComponent.get(componentId) ?? 0;
    const next = nextByComponent.get(componentId) ?? 0;
    const delta = next - previous;
    if (!row) {
      if (next > 0) return { ok: false, message: "Not enough stock for a linked part that is no longer in inventory." };
      continue;
    }
    const ownerId = stockOwnerId(row);
    const current = deltaByOwner.get(ownerId) ?? { name: row.name, unit: row.unit, delta: 0 };
    current.delta += delta;
    deltaByOwner.set(ownerId, current);
  }

  const nextQuantity = new Map<number, number>();
  for (const [ownerId, change] of deltaByOwner) {
    const owner = byId.get(ownerId);
    if (!owner) return { ok: false, message: `Not enough stock for ${change.name}.` };
    const next = owner.quantity - change.delta;
    if (next < -1e-9) {
      const unit = change.unit.trim() || "units";
      const need = change.delta;
      return {
        ok: false,
        message: `Not enough stock for ${change.name}: need ${formatKitAmount(need)} more ${unit}, have ${formatKitAmount(owner.quantity)} ${unit} on hand.`,
      };
    }
    nextQuantity.set(ownerId, next);
  }

  for (const [ownerId, quantity] of nextQuantity) {
    const owner = byId.get(ownerId);
    if (!owner || quantity === owner.quantity) continue;
    await tx.update(inventoryItemsTable).set({
      quantity,
      isLowStock: stockNeedsReorder(quantity, owner.reorderPoint, owner.stockAlerts),
    }).where(and(eq(inventoryItemsTable.id, ownerId), eq(inventoryItemsTable.tenantId, tenantId)));
  }

  for (const { itemId, keys } of identities) {
    await saveKitUse(tx, tenantId, {
      useKey: keys.canonicalKey,
      inventoryItemId: itemId,
      units: wanted.get(itemId) ?? 0,
      jobId: null,
      blueprintId: null,
      parentUsage: {},
      kitUsage: nextByParent.get(itemId) ?? [],
    }, keys.matchKeys);
  }
  return { ok: true };
}
