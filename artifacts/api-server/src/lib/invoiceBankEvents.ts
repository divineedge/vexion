import type Stripe from "stripe";
import { db, invoicesTable, customersTable, activityLogTable, usersTable, taskNotificationsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getStripeClient } from "./stripe";
import { invoiceBalance } from "./customerCredit";

/** Invoked only after Stripe signature verification. No account numbers or provider
 * bank objects are persisted. An unpaid completed Checkout is NOT a payment receipt. */
export async function recordInvoiceBankEvent(
  reference: { metadata: Stripe.Metadata | null; payment_intent: string | Stripe.PaymentIntent | null; id?: string },
  state: "processing" | "failed",
) {
  const tenantId=Number(reference.metadata?.tenantId), invoiceId=Number(reference.metadata?.invoiceId);
  const intentId=typeof reference.payment_intent==="string"?reference.payment_intent:reference.payment_intent?.id;
  if(!intentId || !Number.isSafeInteger(tenantId) || !Number.isSafeInteger(invoiceId) || tenantId<=0 || invoiceId<=0)return;
  const stripe=getStripeClient();if(!stripe)throw new Error("Payments unavailable");
  // Re-read the authoritative current state to ignore out-of-order provider events.
  const intent=await stripe.paymentIntents.retrieve(intentId);
  if(state==="processing" && !["processing","requires_action","requires_confirmation"].includes(intent.status))return;
  if(state==="failed" && !["requires_payment_method","canceled"].includes(intent.status))return;
  await db.transaction(async tx=>{
    const [invoice]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId))).for("update");
    if(!invoice || invoice.status==="paid")return;
    const [payer]=await tx.select().from(customersTable).where(and(eq(customersTable.id,invoice.customerId),eq(customersTable.tenantId,tenantId)));
    const owner=typeof intent.customer==="string"?intent.customer:intent.customer?.id;
    const rows=await tx.execute(sql`SELECT * FROM invoice_card_attempts WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    const attempt=rows.rows[0];
    if(!attempt || !payer?.stripeCustomerId || owner!==payer.stripeCustomerId || intent.currency!=="usd" ||
      intent.amount!==Number(attempt.amount_cents) || Math.round(invoiceBalance(invoice)*100)!==intent.amount ||
      attempt.payment_intent_id && attempt.payment_intent_id!==intentId)return;
    // Completed Checkout events must match our stored session. Intent events are
    // bound through that session, or through the reserved saved-method request.
    if(reference.id?.startsWith("cs_") && attempt.checkout_session_id!==reference.id)return;
    if(!reference.id?.startsWith("cs_") && !attempt.payment_intent_id && attempt.checkout_session_id) {
      const checkout=await stripe.checkout.sessions.retrieve(String(attempt.checkout_session_id));
      const bound=typeof checkout.payment_intent==="string"?checkout.payment_intent:checkout.payment_intent?.id;
      if(bound!==intentId)return;
    }
    if(["succeeded","returned","disputed"].includes(String(attempt.status)))return;
    if(attempt.status===state && attempt.payment_intent_id===intentId)return;
    await tx.execute(sql`UPDATE invoice_card_attempts SET status=${state},payment_intent_id=${intentId},
      error=${state==="failed"?"Payment failed; invoice remains unpaid":null},updated_at=now()
      WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    if(state==="failed") {
      const message=`Invoice ${invoice.invoiceNumber}: online payment failed. The invoice remains unpaid; review and follow up with the customer.`;
      await tx.insert(activityLogTable).values({tenantId,type:"invoice_payment_attention",entityId:invoiceId,message});
      const admins=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),inArray(usersTable.role,["company_owner","office_manager","department_manager"])));
      for(const admin of admins)await tx.insert(taskNotificationsTable).values({tenantId,recipientUserId:admin.id,type:"billing_review",message,linkPath:`/invoices/${invoiceId}`});
    }
  });
}

/** Bank returns can arrive AFTER success. Revoke the mandate permission and block
 * unattended retries. A partial return needs review, never a full automatic re-debit. */
export async function recordInvoiceBankReturn(dispute: Stripe.Dispute) {
  const stripe=getStripeClient();if(!stripe)throw new Error("Payments unavailable");
  const intentId=typeof dispute.payment_intent==="string"?dispute.payment_intent:dispute.payment_intent?.id;
  if(!intentId)return;
  const intent=await stripe.paymentIntents.retrieve(intentId);
  const tenantId=Number(intent.metadata?.tenantId),invoiceId=Number(intent.metadata?.invoiceId);
  if(!Number.isSafeInteger(tenantId)||!Number.isSafeInteger(invoiceId)||tenantId<=0||invoiceId<=0)return;
  const methodId=typeof intent.payment_method==="string"?intent.payment_method:intent.payment_method?.id;
  const method=methodId?await stripe.paymentMethods.retrieve(methodId):null;
  if(!method?.us_bank_account)return;
  await db.transaction(async tx=>{
    const [invoice]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId))).for("update");
    if(!invoice || invoice.paymentReference!==intentId)return;
    const attempts=await tx.execute(sql`SELECT status FROM invoice_card_attempts WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    if(["returned","disputed"].includes(String(attempts.rows[0]?.status)))return;
    const inquiry=dispute.status.startsWith("warning");
    const full=!inquiry && dispute.amount===intent.amount_received;
    if(full)await tx.update(invoicesTable).set({status:"sent",paidAt:null}).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId)));
    await tx.execute(sql`UPDATE invoice_card_attempts SET status=${full?"returned":"disputed"},error='Bank payment return or dispute requires staff review',updated_at=now()
      WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    if(!inquiry)await tx.update(customersTable).set({automaticPaymentAuthorizedAt:null,paymentAuthorizationMethodId:null})
      .where(and(eq(customersTable.id,invoice.customerId),eq(customersTable.tenantId,tenantId),eq(customersTable.paymentAuthorizationMethodId,methodId!)));
    const message=`Invoice ${invoice.invoiceNumber}: ACH ${inquiry?"authorization inquiry":"return or dispute"} for $${(dispute.amount/100).toFixed(2)}. ${full?"Invoice reopened as unpaid.":"Reconcile the returned amount before changing the invoice balance."} Automatic recharging is blocked; review in Stripe.`;
    await tx.insert(activityLogTable).values({tenantId,type:"invoice_payment_attention",entityId:invoiceId,message});
    const admins=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),inArray(usersTable.role,["company_owner","office_manager","department_manager"])));
    for(const admin of admins)await tx.insert(taskNotificationsTable).values({tenantId,recipientUserId:admin.id,type:"billing_review",message,linkPath:`/invoices/${invoiceId}`});
  });
}
