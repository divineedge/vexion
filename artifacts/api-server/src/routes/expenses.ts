import { Router, type IRouter } from "express";
import { db, expenseEntriesTable, vendorsTable, mediaAttachmentsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { recordExpense } from "../lib/expenseInventory";
import {expenseTax} from '../lib/expenseTax';
import { CreateExpenseBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function vendorBelongsToTenant(tenantId: number, vendorId: number): Promise<boolean> {
  const [v] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.tenantId, tenantId)));
  return !!v;
}

function fmt(e: typeof expenseEntriesTable.$inferSelect, vendorName?: string | null) {
  const { requestFingerprint: _privateFingerprint, ...publicEntry } = e;
  return {
    ...publicEntry,
    vendorName: vendorName ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

router.get("/expenses", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { startDate, endDate, category, vendorId } = req.query as Record<string, string>;

  let where = eq(expenseEntriesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (startDate) where = and(where, sql`${expenseEntriesTable.date} >= ${startDate}`) as typeof where;
  if (endDate) where = and(where, sql`${expenseEntriesTable.date} <= ${endDate}`) as typeof where;
  if (category) where = and(where, eq(expenseEntriesTable.category, category)) as typeof where;
  if (vendorId) where = and(where, eq(expenseEntriesTable.vendorId, parseInt(vendorId, 10))) as typeof where;

  const rows = await db
    .select({ expense: expenseEntriesTable, vendorName: vendorsTable.name })
    .from(expenseEntriesTable)
    .leftJoin(vendorsTable, eq(expenseEntriesTable.vendorId, vendorsTable.id))
    .where(where)
    .orderBy(sql`${expenseEntriesTable.date} DESC`);

  res.json(rows.map(r => fmt(r.expense, r.vendorName)));
});

router.get("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [row] = await db
    .select({ expense: expenseEntriesTable, vendorName: vendorsTable.name })
    .from(expenseEntriesTable)
    .leftJoin(vendorsTable, eq(expenseEntriesTable.vendorId, vendorsTable.id))
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row.expense, row.vendorName));
});

router.post("/expenses", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid expense or inventory receipt", details: parsed.error.flatten() }); return; }
  try { res.status(201).json(fmt(await recordExpense(tenantId, parsed.data, userId))); }
  catch (error) {
    const failure = error as Error & {status?:number};
    if (failure.status) { res.status(failure.status).json({error:failure.message}); return; }
    throw error;
  }
});

router.patch("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  if (req.body.inventoryReceipts !== undefined || req.body.requestId !== undefined) { res.status(409).json({error:"Inventory was received when this expense was created. Use an inventory adjustment to correct stock."}); return; }
  const { vendorId, date, amount, category, description, receiptUrl } = req.body;
  const hasTax=['subtotal','salesTaxPct','capitalizeSalesTax','shippingAmount','capitalizeShipping'].some(k=>req.body[k]!==undefined);
  const [prior]=await db.select().from(expenseEntriesTable).where(and(eq(expenseEntriesTable.id,id),eq(expenseEntriesTable.tenantId,tenantId)));
  if(!prior){res.status(404).json({error:'Expense not found'});return;}
  const base=req.body.subtotal??prior.subtotal??(prior.amount-prior.salesTaxAmount-prior.shippingAmount);
  const rate=req.body.salesTaxPct??prior.salesTaxPct;
  const shipping=req.body.shippingAmount??prior.shippingAmount;
  const tax=hasTax?expenseTax({amount:amount===undefined?Math.round((base+Math.round(base*rate)/100+shipping)*100)/100:Number(amount),subtotal:base,salesTaxPct:rate,capitalizeSalesTax:req.body.capitalizeSalesTax??prior.capitalizeSalesTax,shippingAmount:shipping,capitalizeShipping:req.body.capitalizeShipping??prior.capitalizeShipping}):null;
  const receivedRows=Array.isArray(prior.inventoryReceipts)&&prior.inventoryReceipts.length>0;
  if(receivedRows&&((amount!==undefined&&Number(amount)!==prior.amount)||(tax&&(tax.subtotal!==prior.subtotal||tax.salesTaxPct!==prior.salesTaxPct||tax.salesTaxAmount!==prior.salesTaxAmount||tax.capitalizeSalesTax!==prior.capitalizeSalesTax||tax.shippingAmount!==prior.shippingAmount||tax.capitalizeShipping!==prior.capitalizeShipping)))){
   res.status(409).json({error:'Purchase totals and tax are locked after inventory is received. Use an inventory adjustment to correct supply costs.'});return;
  }
  if(!hasTax&&amount!==undefined&&(prior.salesTaxPct>0||prior.shippingAmount>0)&&Number(amount)!==prior.amount){res.status(400).json({error:'Update the subtotal, tax and shipping together with the total'});return;}
  if(amount!==undefined){
    const [existing]=await db.select().from(expenseEntriesTable).where(and(eq(expenseEntriesTable.id,id),eq(expenseEntriesTable.tenantId,tenantId)));
    if(!existing){res.status(404).json({error:"Expense not found"});return;}
    const received=(existing.inventoryReceipts as {quantity:number;costPrice:number}[]??[]).reduce((sum,r)=>sum+r.quantity*r.costPrice,0);
    if(!Number.isFinite(Number(amount)) || Number(amount)<received-.005 || Number(amount)<0){res.status(400).json({error:"Expense amount cannot be less than the inventory purchase amount"});return;}
  }
  if (vendorId && !(await vendorBelongsToTenant(tenantId, parseInt(vendorId, 10)))) {
    res.status(400).json({ error: "Invalid vendorId" }); return;
  }
  const update: Partial<typeof expenseEntriesTable.$inferInsert> = {};
  if(tax){Object.assign(update,tax);}
  if (vendorId !== undefined) update.vendorId = vendorId ? parseInt(vendorId, 10) : null;
  if (date !== undefined) update.date = date;
  if (amount !== undefined) update.amount = tax?tax.amount:Number(amount);
  if (category !== undefined) update.category = category;
  if (description !== undefined) update.description = description;
  if (receiptUrl !== undefined) update.receiptUrl = receiptUrl;
  if(!Object.keys(update).length){res.json(fmt(prior));return;}

  const [updated] = await db.update(expenseEntriesTable).set(update).where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [entry] = await db.select().from(expenseEntriesTable).where(and(eq(expenseEntriesTable.id,id),eq(expenseEntriesTable.tenantId,tenantId)));
  if (Array.isArray(entry?.inventoryReceipts) && entry.inventoryReceipts.length) { res.status(409).json({error:"Keep this expense as the stock-receipt audit record. Correct inventory with an adjustment instead of deleting its purchase history."}); return; }
  await db.delete(expenseEntriesTable).where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

/**
 * POST /expenses/:id/receipt
 * Registers the uploaded receipt file as a media_attachments record (required
 * for /storage/read-url ownership verification) and updates the expense's receiptUrl.
 */
router.post("/expenses/:id/receipt", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [expense] = await db.select({ id: expenseEntriesTable.id })
    .from(expenseEntriesTable)
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)))
    .limit(1);
  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

  const { fileKey, mimeType, sizeBytes } = req.body as { fileKey?: string; mimeType?: string; sizeBytes?: number };
  if (!fileKey || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "fileKey, mimeType, sizeBytes are required" }); return;
  }
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  if (!isImage && !isPdf) {
    res.status(400).json({ error: "Only images and PDFs are allowed for receipts" }); return;
  }

  // Remove any prior media attachment for this expense's receipt
  await db.delete(mediaAttachmentsTable).where(and(
    eq(mediaAttachmentsTable.tenantId, tenantId),
    eq(mediaAttachmentsTable.entityType, "expense"),
    eq(mediaAttachmentsTable.entityId, id),
  ));

  await db.insert(mediaAttachmentsTable).values({
    tenantId,
    entityType: "expense",
    entityId: id,
    fileKey,
    fileUrl: fileKey,
    mimeType,
    sizeBytes: Number(sizeBytes),
    caption: null,
    isCover: false,
    createdBy: userId,
  });

  const [updated] = await db.update(expenseEntriesTable)
    .set({ receiptUrl: fileKey })
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)))
    .returning();

  res.json(fmt(updated));
});

/**
 * DELETE /expenses/:id/receipt
 * Removes the receipt attachment and clears receiptUrl on the expense.
 */
router.delete("/expenses/:id/receipt", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [expense] = await db.select({ id: expenseEntriesTable.id })
    .from(expenseEntriesTable)
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)))
    .limit(1);
  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

  await db.delete(mediaAttachmentsTable).where(and(
    eq(mediaAttachmentsTable.tenantId, tenantId),
    eq(mediaAttachmentsTable.entityType, "expense"),
    eq(mediaAttachmentsTable.entityId, id),
  ));

  const [updated] = await db.update(expenseEntriesTable)
    .set({ receiptUrl: null })
    .where(and(eq(expenseEntriesTable.id, id), eq(expenseEntriesTable.tenantId, tenantId)))
    .returning();

  res.json(fmt(updated));
});

export default router;
