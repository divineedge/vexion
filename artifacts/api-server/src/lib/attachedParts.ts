import { and, eq, inArray } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryPartLinkComponentsTable, inventoryPartLinksTable } from "@workspace/db";
import { installInventoryKitSchema } from "./inventoryKitSchema";
import { LineItemError, prepareLineItems } from "./customLineItems";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Inventory item ids stored on multi-part lines. Duplicates are already merged. */
export function attachedPartIds(items: unknown[]): number[] {
  const ids = new Set<number>();
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    if (!isRecord(item) || !Array.isArray(item.components)) continue;
    for (const component of item.components) {
      if (!isRecord(component)) continue;
      const id = component.inventoryItemId;
      if (typeof id === "number" && Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

function kitParentIds(items: unknown[]): number[] {
  const ids = new Set<number>();
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    if (!isRecord(item) || item.kind !== "kit") continue;
    const id = item.inventoryItemId;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Attached parts must already be inventory items.
 * A kit line must already be an inventory kit. This does not create parts or deduct stock.
 */
export async function assertBillingLines(tenantId: number, items: unknown[]): Promise<void> {
  const partIds = attachedPartIds(items);
  if (partIds.length > 0) {
    const rows = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable).where(and(
      eq(inventoryItemsTable.tenantId, tenantId),
      inArray(inventoryItemsTable.id, partIds),
    ));
    if (rows.length !== partIds.length) throw new LineItemError("Each attached part must be an inventory item");
  }
  const kitIds = kitParentIds(items);
  if (kitIds.length === 0) return;
  await installInventoryKitSchema();
  const kits = await db
    .selectDistinct({ parentItemId: inventoryPartLinksTable.parentItemId })
    .from(inventoryPartLinksTable)
    .innerJoin(inventoryPartLinkComponentsTable, eq(inventoryPartLinkComponentsTable.linkId, inventoryPartLinksTable.id))
    .where(and(
      eq(inventoryPartLinksTable.tenantId, tenantId),
      inArray(inventoryPartLinksTable.parentItemId, kitIds),
    ));
  if (kits.length !== kitIds.length) {
    throw new LineItemError("A kit line has to be an inventory kit. Add parts in Inventory before building a kit.");
  }
}

/** Normalize lines, then reject invented parts or kits. Does not move stock. */
export async function prepareStoredLineItems<T>(tenantId: number, items: T[], mode: "estimate" | "invoice"): Promise<T[]> {
  const prepared = prepareLineItems(items, mode);
  await assertBillingLines(tenantId, prepared);
  return prepared;
}
