import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { CreatePublicInvoicePaymentBody } from "@workspace/api-zod";
import { invoiceCheckout } from "../lib/invoiceCheckout";
import { validCardChoice } from "../lib/cardAuthorization";
import { publicAppUrl } from "../lib/publicSite";
import { chargeInvoiceCard } from "../lib/invoiceCardPayments";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
const router:IRouter=Router();
router.post("/public/invoices/:token/pay-session",async(req,res):Promise<void>=>{
  const parsed=CreatePublicInvoicePaymentBody.safeParse(req.body);
  if(!parsed.success || !validCardChoice(parsed.data)){res.status(400).json({error:"Choose whether to save your card and accept the displayed authorization if saving it."});return;}
  const [invoice]=await db.select().from(invoicesTable).where(eq(invoicesTable.publicToken,req.params.token));
  if(!invoice){res.status(404).json({error:"Invoice not found"});return;}
  try {res.json(await invoiceCheckout(invoice.tenantId,invoice.customerId,invoice.id,parsed.data.saveCard,`${publicAppUrl}/invoice/${encodeURIComponent(req.params.token)}`));}
  catch(error){res.status(409).json({error:(error as Error).message});}
});
router.post("/invoices/:id/charge-card",async(req,res):Promise<void>=>{
  if(!await isAdminRole(getTenantId(req),getUserId(req))){res.status(403).json({error:"Office payment access required"});return;}
  const id=Number(req.params.id),tenantId=getTenantId(req);
  if(!Number.isSafeInteger(id)||id<=0){res.status(400).json({error:"Invalid invoice"});return;}
  const [invoice]=await db.select({id:invoicesTable.id}).from(invoicesTable).where(and(eq(invoicesTable.id,id),eq(invoicesTable.tenantId,tenantId)));
  if(!invoice){res.status(404).json({error:"Invoice not found"});return;}
  const result=await chargeInvoiceCard(tenantId,id);
  res.json(result);
});
export default router;
