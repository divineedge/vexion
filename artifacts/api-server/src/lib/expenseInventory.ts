import { db, expenseEntriesTable, inventoryItemsTable, inventoryLocationsTable, inventoryLocationStockTable, inventoryTransfersTable, tenantsTable, vendorsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { CreateExpenseBody } from "@workspace/api-zod";
import type { z } from "zod";
type CreateExpenseInput = z.infer<typeof CreateExpenseBody>;

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
export async function recordExpense(tenantId: number, input: CreateExpenseInput, actorId: number) {
  const receipts = (input.inventoryReceipts ?? []).map(row => ({
    inventoryItemId: row.inventoryItemId, locationId: row.locationId,
    quantity: row.quantity, costPrice: row.costPrice, updatePrice: row.updatePrice, markupPct: row.markupPct,
  }));
  if (receipts.length && !input.requestId) fail("A request ID is required to receive inventory safely");
  if (!Number.isFinite(input.amount) || input.amount < 0) fail("Amount must be non-negative");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10) !== input.date) fail("Invalid expense date");
  if (new Set(receipts.map(r => r.inventoryItemId)).size !== receipts.length) fail("Use one receipt row per inventory item");
  if (receipts.reduce((sum, row) => sum + row.quantity*row.costPrice, 0) > input.amount + .005) fail("Inventory purchase costs cannot exceed the expense total");
  const normal = { vendorId: input.vendorId ?? null, date: input.date, amount: input.amount, category: input.category ?? null, description: input.description ?? null, receiptUrl: input.receiptUrl ?? null, receipts };
  const fingerprint = createHash("sha256").update(JSON.stringify(normal)).digest("hex");
  return db.transaction(async tx => {
    if (input.requestId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},hashtext(${input.requestId}))`);
      const [old] = await tx.select().from(expenseEntriesTable).where(and(eq(expenseEntriesTable.tenantId,tenantId),eq(expenseEntriesTable.requestId,input.requestId)));
      if (old) { if (old.requestFingerprint !== fingerprint) fail("This request already saved a different expense",409); return old; }
    }
    let category=input.category??'other';
    if (input.vendorId) {
      const [vendor] = await tx.select().from(vendorsTable).where(and(eq(vendorsTable.tenantId,tenantId),eq(vendorsTable.id,input.vendorId)));
      if (!vendor) fail("Invalid vendor");
      if(input.category==null&&vendor.category)category=vendor.category;
    }
    const [tenant] = await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    const locations = receipts.length ? await tx.select().from(inventoryLocationsTable).where(and(eq(inventoryLocationsTable.tenantId,tenantId),eq(inventoryLocationsTable.isActive,true))) : [];
    if (receipts.length) await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-19001)`);
    const snapshots = [];
    // Consistent item lock order prevents concurrent multi-item receipts deadlocking.
    for (const receipt of [...receipts].sort((a,b)=>a.inventoryItemId-b.inventoryItemId)) {
      const [item] = await tx.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.tenantId,tenantId),eq(inventoryItemsTable.id,receipt.inventoryItemId))).for("update");
      if (!item) fail("Inventory item does not belong to this business");
      const location = receipt.locationId ? locations.find(l=>l.id===receipt.locationId) : locations.length===1 ? locations[0] : null;
      if (receipt.locationId && !location) fail("Choose an active receiving location in this business");
      if (!location && locations.length>1) fail("Choose the receiving location for each item");
      const markup = receipt.markupPct ?? (item.unitPrice>0 ? Math.max(0,(item.markedUpPrice/item.unitPrice-1)*100) : tenant.defaultMarkupPct);
      const sell = Math.round(receipt.costPrice*(1+markup/100)*100)/100;
      if (!Number.isFinite(sell)) fail("Invalid resulting supply price");
      if (item.quantity + receipt.quantity > 2147483647) fail("Resulting stock quantity is too large");
      const stocks = await tx.select().from(inventoryLocationStockTable).where(and(eq(inventoryLocationStockTable.tenantId,tenantId),eq(inventoryLocationStockTable.inventoryItemId,item.id)));
      if (location) {
        // Preserve old, unallocated quantities instead of silently losing or relocating them.
        if (!stocks.length && item.quantity>0) {
          const [existing] = await tx.select().from(inventoryLocationsTable).where(and(eq(inventoryLocationsTable.tenantId,tenantId),eq(inventoryLocationsTable.name,"Unassigned legacy stock")));
          const unassigned = existing ?? (await tx.insert(inventoryLocationsTable).values({tenantId,name:"Unassigned legacy stock",type:"other",description:"Existing stock with no recorded receiving location"}).returning())[0];
          await tx.insert(inventoryLocationStockTable).values({tenantId,inventoryItemId:item.id,locationId:unassigned.id,quantity:item.quantity});
        }
        await tx.insert(inventoryLocationStockTable).values({tenantId,inventoryItemId:item.id,locationId:location.id,quantity:receipt.quantity}).onConflictDoUpdate({
          target:[inventoryLocationStockTable.tenantId,inventoryLocationStockTable.inventoryItemId,inventoryLocationStockTable.locationId],
          set:{quantity:sql`${inventoryLocationStockTable.quantity}+${receipt.quantity}`},
        });
      } else if (stocks.length) fail("Choose an active receiving location");
      await tx.update(inventoryItemsTable).set({
        quantity:item.quantity+receipt.quantity, isLowStock:item.quantity+receipt.quantity<=item.reorderPoint,
        ...(receipt.updatePrice ? {unitPrice:receipt.costPrice,markedUpPrice:sell} : {}),
      }).where(and(eq(inventoryItemsTable.tenantId,tenantId),eq(inventoryItemsTable.id,item.id)));
      snapshots.push({...receipt,locationId:location?.id,locationName:location?.name ?? "Unallocated inventory",itemName:item.name,previousCostPrice:item.unitPrice,previousSellPrice:item.markedUpPrice,newSellPrice:receipt.updatePrice?sell:item.markedUpPrice});
    }
    const [expense] = await tx.insert(expenseEntriesTable).values({
      tenantId,...normal,category, requestId:input.requestId ?? null, requestFingerprint:fingerprint, inventoryReceipts:snapshots,
    }).returning();
    for (const row of snapshots) await tx.insert(inventoryTransfersTable).values({tenantId,inventoryItemId:row.inventoryItemId,toLocationId:row.locationId ?? null,quantity:row.quantity,reason:`Vendor expense #${expense.id} purchase receipt by staff #${actorId}`});
    return expense;
  });
}
