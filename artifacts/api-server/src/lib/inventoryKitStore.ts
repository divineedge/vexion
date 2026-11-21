import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryKitUsesTable,
  inventoryPartLinkComponentsTable,
  inventoryPartLinksTable,
} from "@workspace/db";
import type { HrDb } from "./hrAccess";
import { installInventoryKitSchema } from "./inventoryKitSchema";
import { combinedUnitCost, parseLinkedPartsBody, type KitRatio, type RatioComponent } from "./inventoryKits";

export type LinkedPartView = {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string;
  onHand: number;
  unitCost: number;
};

export type LinkedPartsView = {
  quantity: number;
  components: LinkedPartView[];
  /** Sum of component costs for 1 unit of this part. Null when buy prices are hidden. */
  combinedCost: number | null;
  /** Manual replacement for combinedCost. Null uses the sum. */
  costOverride: number | null;
};

export async function linkedPartsByParent(tenantId: number, parentIds?: number[]): Promise<Map<number, LinkedPartsView>> {
  await installInventoryKitSchema();
  const map = new Map<number, LinkedPartsView>();
  if (parentIds && parentIds.length === 0) return map;
  const rows = await db.select({
    parentItemId: inventoryPartLinksTable.parentItemId,
    parentQuantity: inventoryPartLinksTable.parentQuantity,
    inventoryItemId: inventoryPartLinkComponentsTable.inventoryItemId,
    quantity: inventoryPartLinkComponentsTable.quantity,
    name: inventoryItemsTable.name,
    unit: inventoryItemsTable.unit,
    onHand: inventoryItemsTable.quantity,
    unitCost: inventoryItemsTable.unitPrice,
    costOverride: inventoryPartLinksTable.costOverride,
  })
    .from(inventoryPartLinksTable)
    .innerJoin(inventoryPartLinkComponentsTable, eq(inventoryPartLinkComponentsTable.linkId, inventoryPartLinksTable.id))
    .innerJoin(inventoryItemsTable, and(
      eq(inventoryItemsTable.id, inventoryPartLinkComponentsTable.inventoryItemId),
      eq(inventoryItemsTable.tenantId, tenantId),
    ))
    .where(and(
      eq(inventoryPartLinksTable.tenantId, tenantId),
      parentIds ? inArray(inventoryPartLinksTable.parentItemId, parentIds) : undefined,
    ))
    .orderBy(asc(inventoryPartLinkComponentsTable.sortOrder), asc(inventoryPartLinkComponentsTable.id));

  for (const row of rows) {
    const current = map.get(row.parentItemId) ?? {
      quantity: row.parentQuantity,
      components: [],
      combinedCost: 0,
      costOverride: row.costOverride,
    };
    current.quantity = row.parentQuantity;
    current.costOverride = row.costOverride;
    current.components.push({
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      onHand: row.onHand,
      unitCost: row.unitCost,
    });
    current.combinedCost = combinedUnitCost(current.quantity, current.components, null);
    map.set(row.parentItemId, current);
  }
  return map;
}

export async function readKitRatio(tx: HrDb, tenantId: number, parentItemId: number): Promise<KitRatio | null> {
  const [link] = await tx.select({
    id: inventoryPartLinksTable.id,
    parentQuantity: inventoryPartLinksTable.parentQuantity,
    costOverride: inventoryPartLinksTable.costOverride,
  }).from(inventoryPartLinksTable).where(and(
    eq(inventoryPartLinksTable.tenantId, tenantId),
    eq(inventoryPartLinksTable.parentItemId, parentItemId),
  ));
  if (!link) return null;
  const components = await tx.select({
    inventoryItemId: inventoryPartLinkComponentsTable.inventoryItemId,
    quantity: inventoryPartLinkComponentsTable.quantity,
  }).from(inventoryPartLinkComponentsTable).where(and(
    eq(inventoryPartLinkComponentsTable.tenantId, tenantId),
    eq(inventoryPartLinkComponentsTable.linkId, link.id),
  )).orderBy(asc(inventoryPartLinkComponentsTable.sortOrder), asc(inventoryPartLinkComponentsTable.id));
  if (components.length === 0) return null;
  return { parentQuantity: link.parentQuantity, components, costOverride: link.costOverride };
}

async function componentsBelongToTenant(tenantId: number, components: RatioComponent[]): Promise<string | null> {
  const ids = components.map(component => component.inventoryItemId);
  const rows = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable).where(and(
    eq(inventoryItemsTable.tenantId, tenantId),
    inArray(inventoryItemsTable.id, ids),
  ));
  if (rows.length !== ids.length) return "Choose linked parts from inventory.";
  return null;
}

/** Replace the ratio on a parent item. Null clears it. Undefined is not a caller's job; pass null to clear. */
export async function writeLinkedParts(
  tenantId: number,
  parentItemId: number,
  linked: { quantity: number; components: RatioComponent[]; costOverride?: number | null } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (linked && linked.components.some(component => component.inventoryItemId === parentItemId)) {
    return { ok: false, error: "A part cannot be linked to itself." };
  }
  if (linked) {
    const missing = await componentsBelongToTenant(tenantId, linked.components);
    if (missing) return { ok: false, error: missing };
  }
  await installInventoryKitSchema();
  await db.transaction(async tx => {
    await tx.delete(inventoryPartLinksTable).where(and(
      eq(inventoryPartLinksTable.tenantId, tenantId),
      eq(inventoryPartLinksTable.parentItemId, parentItemId),
    ));
    if (!linked) return;
    const [link] = await tx.insert(inventoryPartLinksTable).values({
      tenantId,
      parentItemId,
      parentQuantity: linked.quantity,
      costOverride: linked.costOverride ?? null,
    }).returning({ id: inventoryPartLinksTable.id });
    await tx.insert(inventoryPartLinkComponentsTable).values(linked.components.map((component, index) => ({
      tenantId,
      linkId: link.id,
      inventoryItemId: component.inventoryItemId,
      quantity: component.quantity,
      sortOrder: index,
    })));
  });
  return { ok: true };
}

export async function saveLinkedPartsFromBody(
  tenantId: number,
  parentItemId: number,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseLinkedPartsBody(body);
  if (!parsed.ok) return parsed;
  return writeLinkedParts(tenantId, parentItemId, parsed.value);
}

export type KitUseRecord = {
  useKey: string;
  units: number;
  jobId: number | null;
  blueprintId: number | null;
  parentUsage: unknown;
  kitUsage: unknown;
};

export async function readKitUses(tx: HrDb, tenantId: number, keys: readonly string[]): Promise<KitUseRecord[]> {
  if (keys.length === 0) return [];
  const rows = await tx.select({
    useKey: inventoryKitUsesTable.useKey,
    units: inventoryKitUsesTable.units,
    jobId: inventoryKitUsesTable.jobId,
    blueprintId: inventoryKitUsesTable.blueprintId,
    parentUsage: inventoryKitUsesTable.parentUsage,
    kitUsage: inventoryKitUsesTable.kitUsage,
  }).from(inventoryKitUsesTable).where(and(
    eq(inventoryKitUsesTable.tenantId, tenantId),
    inArray(inventoryKitUsesTable.useKey, [...keys]),
  ));
  return rows;
}

export async function saveKitUse(
  tx: HrDb,
  tenantId: number,
  row: {
    useKey: string;
    inventoryItemId: number;
    units: number;
    jobId: number | null;
    blueprintId: number | null;
    parentUsage: unknown;
    kitUsage: unknown;
  },
  deleteKeys: readonly string[],
): Promise<void> {
  await tx.insert(inventoryKitUsesTable).values({
    tenantId,
    useKey: row.useKey,
    inventoryItemId: row.inventoryItemId,
    units: row.units,
    jobId: row.jobId,
    blueprintId: row.blueprintId,
    parentUsage: row.parentUsage ?? {},
    kitUsage: row.kitUsage ?? [],
  }).onConflictDoUpdate({
    target: [inventoryKitUsesTable.tenantId, inventoryKitUsesTable.useKey],
    set: {
      inventoryItemId: row.inventoryItemId,
      units: row.units,
      jobId: row.jobId,
      blueprintId: row.blueprintId,
      parentUsage: row.parentUsage ?? {},
      kitUsage: row.kitUsage ?? [],
      updatedAt: new Date(),
    },
  });
  const extras = deleteKeys.filter(key => key !== row.useKey);
  if (extras.length === 0) return;
  await tx.delete(inventoryKitUsesTable).where(and(
    eq(inventoryKitUsesTable.tenantId, tenantId),
    inArray(inventoryKitUsesTable.useKey, extras),
  ));
}
