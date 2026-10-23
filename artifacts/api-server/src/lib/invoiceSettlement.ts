import type Stripe from "stripe";
import { db, invoicesTable, customersTable, activityLogTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getStripeClient } from "./stripe";
import { invoiceBalance } from "./customerCredit";
import { authorizeSavedCard, CARD_AUTHORIZATION_VERSION } from "./cardAuthorization";

/** Only call with a signature-verified provider event. Browser return URLs never settle money. */
export async function settleInvoiceCheckout(session:Pick<Stripe.Checkout.Session,"id"|"payment_status"|"payment_intent"|"customer"|"amount_total"|"metadata">){
  if(session.payment_status!=="paid")return;
  const tenantId=Number(session.metadata?.tenantId),invoiceId=Number(session.metadata?.invoiceId);
  if(!Number.isSafeInteger(tenantId)||!Number.isSafeInteger(invoiceId)||tenantId<=0||invoiceId<=0)return;
  const stripe=getStripeClient();if(!stripe)throw new Error("Payments unavailable");
  const intentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
  if(!intentId)throw new Error("Missing confirmed payment");
  const intent=await stripe.paymentIntents.retrieve(intentId);
  const [invoice]=await db.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId)));
  if(!invoice)throw new Error("Invoice not found");
  const [payer]=await db.select().from(customersTable).where(and(eq(customersTable.id,invoice.customerId),eq(customersTable.tenantId,tenantId)));
  const intentCustomer=typeof intent.customer==="string"?intent.customer:intent.customer?.id;
  const sessionCustomer=typeof session.customer==="string"?session.customer:session.customer?.id;
  if(!payer?.stripeCustomerId||intentCustomer!==payer.stripeCustomerId||sessionCustomer!==payer.stripeCustomerId||
    intent.status!=="succeeded"||intent.currency!=="usd"||intent.amount_received!==session.amount_total)
    throw new Error("Provider payment ownership or amount could not be verified");
  const settled=await db.transaction(async tx=>{
    const [current]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId))).for("update");
    if(current.status==="paid" && current.paymentReference===intentId)return true;
    if(current.status==="paid" || Math.round(invoiceBalance(current)*100)!==intent.amount_received){
      await tx.insert(activityLogTable).values({tenantId,type:"invoice_payment_attention",entityId:invoiceId,
        message:`Invoice ${current.invoiceNumber}: provider received a payment that does not match the current remaining balance. Review in the payment platform; do not charge again.`});
      await tx.execute(sql`UPDATE invoice_card_attempts SET status='unknown',payment_intent_id=${intentId},updated_at=now() WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
      return false;
    }
    await tx.update(invoicesTable).set({status:"paid",paidAt:new Date(),paymentMethod:"card",paymentReference:intentId})
      .where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId)));
    await tx.execute(sql`INSERT INTO invoice_card_attempts(invoice_id,tenant_id,status,attempt_key,amount_cents,payment_intent_id)
      VALUES(${invoiceId},${tenantId},'succeeded',${`settled-${intentId}`},${intent.amount_received},${intentId})
      ON CONFLICT(invoice_id) DO UPDATE SET status='succeeded',payment_intent_id=excluded.payment_intent_id,error=NULL,updated_at=now()`);
    await tx.insert(activityLogTable).values({tenantId,type:"payment_received",entityId:invoiceId,message:`Invoice ${current.invoiceNumber}: payment of $${(intent.amount_received/100).toFixed(2)} processed successfully.`});
    return true;
  });
  const method=typeof intent.payment_method==="string"?intent.payment_method:intent.payment_method?.id;
  if(settled && method && session.metadata?.saveCard==="true" && session.metadata.authorizationVersion===CARD_AUTHORIZATION_VERSION){
    const previous=await db.execute(sql`SELECT checkout_authorization_saved FROM invoice_card_attempts WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    // Re-delivered webhooks must not restore a card a customer later removed.
    if(previous.rows[0]?.checkout_authorization_saved)return;
    await authorizeSavedCard(tenantId,payer.id,method,`invoice-checkout:${session.id}`);
    await db.execute(sql`UPDATE invoice_card_attempts SET checkout_authorization_saved=true WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
  }
}
