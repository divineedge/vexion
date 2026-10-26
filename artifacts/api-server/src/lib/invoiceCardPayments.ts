import { randomUUID } from "node:crypto";
import { db, invoicesTable, customersTable, tenantsTable, activityLogTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getStripeClient } from "./stripe";
import { platformPaymentMetadata } from "./platformBillingPolicy";
import { invoiceBalance } from "./customerCredit";
import type Stripe from "stripe";
import { allowedInvoiceMethods, readAchPolicy } from "./achPolicy";

export type InvoiceChargeResult = {status:"paid"|"failed"|"pending"|"unavailable";message:string};
type Attempt = {status:string;attempt_key:string;amount_cents:number;payment_intent_id:string|null;checkout_session_id:string|null;checkout_url:string|null;payment_method_id:string|null;updated_at:Date;reserved_at:Date;request_payload:Stripe.PaymentIntentCreateParams|null};

/** Invoice row locking plus a durable provider idempotency key prevents duplicate charges
 * across staff clicks, automatic delivery, process crashes and uncertain provider timeouts. */
export async function chargeInvoiceCard(tenantId:number, invoiceId:number, automatic: false|"when_sent"|"due_date"=false):Promise<InvoiceChargeResult> {
  const stripe=getStripeClient();
  if(!stripe)return {status:"unavailable",message:"Online payments are not configured."};
  // Commit the reservation BEFORE contacting the provider. A process crash must
  // not roll back the idempotency key and allow a fresh, duplicate payment.
  await db.transaction(async tx=>{
    const [invoice]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId))).for("update");
    if(!invoice || !["sent","overdue"].includes(invoice.status) || invoiceBalance(invoice)<=0)return;
    const [company]=await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    if(automatic && (company?.automaticInvoicePaymentMode!==automatic || !company.stripeEnabled))return;
    const [customer]=await tx.select().from(customersTable).where(and(eq(customersTable.id,invoice.customerId),eq(customersTable.tenantId,tenantId)));
    if(!customer?.stripeDefaultPaymentMethodId || !customer.automaticPaymentAuthorizedAt || customer.paymentAuthorizationMethodId!==customer.stripeDefaultPaymentMethodId)return;
    if(automatic && customer.automaticPaymentAuthorizedAt>invoice.createdAt)return;
    const saved=await stripe.paymentMethods.retrieve(customer.stripeDefaultPaymentMethodId);
    const owner=typeof saved.customer==="string"?saved.customer:saved.customer?.id;
    const methodType=saved.us_bank_account?"us_bank_account":saved.card?"card":null;
    if(owner!==customer.stripeCustomerId || !methodType ||
      !allowedInvoiceMethods(readAchPolicy(company?.paymentPolicy),Math.round(invoiceBalance(invoice)*100)).includes(methodType))return;
    const rows=await tx.execute(sql`SELECT * FROM invoice_card_attempts WHERE invoice_id=${invoiceId}`);
    const previous=rows.rows[0] as unknown as Attempt|undefined;
    if(previous && !(previous.status==="failed" && !automatic))return;
    const payload:Stripe.PaymentIntentCreateParams={
      customer:customer.stripeCustomerId!,payment_method:customer.stripeDefaultPaymentMethodId,amount:Math.round(invoiceBalance(invoice)*100),currency:"usd",
      confirm:true,off_session:true,payment_method_types:[methodType],description:`Invoice ${invoice.invoiceNumber}`,
      metadata:{...await platformPaymentMetadata(tenantId,Math.round(invoiceBalance(invoice)*100)),invoiceId:String(invoiceId),tenantId:String(tenantId),source:"invoice_card"},
    };
    await tx.execute(sql`INSERT INTO invoice_card_attempts(invoice_id,tenant_id,status,attempt_key,amount_cents,payment_method_id,request_payload)
      VALUES(${invoiceId},${tenantId},'reserved',${`invoice-${invoiceId}-${randomUUID()}`},${Math.round(invoiceBalance(invoice)*100)},${customer.stripeDefaultPaymentMethodId},${JSON.stringify(payload)}::jsonb)
      ON CONFLICT(invoice_id) DO UPDATE SET status='reserved',attempt_key=excluded.attempt_key,amount_cents=excluded.amount_cents,
      payment_method_id=excluded.payment_method_id,payment_intent_id=NULL,request_payload=excluded.request_payload,reserved_at=now(),updated_at=now()`);
  });
  return db.transaction(async tx=>{
    const [invoice]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId))).for("update");
    if(!invoice)return {status:"unavailable",message:"Invoice not found."};
    if(invoice.status==="paid" || invoiceBalance(invoice)<=0)return {status:"paid",message:"This invoice has no balance due."};
    if(!["sent","overdue"].includes(invoice.status))return {status:"unavailable",message:"Send the invoice before charging it."};
    const [company]=await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    if(!company?.stripeEnabled)return {status:"unavailable",message:"Payments are not enabled for this company."};
    if(automatic && company.automaticInvoicePaymentMode!==automatic)return {status:"unavailable",message:"This automatic payment mode is not selected."};
    const [customer]=await tx.select().from(customersTable).where(and(eq(customersTable.id,invoice.customerId),eq(customersTable.tenantId,tenantId)));
    if(!customer?.stripeCustomerId || !customer.stripeDefaultPaymentMethodId || !customer.automaticPaymentAuthorizedAt ||
      customer.paymentAuthorizationMethodId!==customer.stripeDefaultPaymentMethodId)
      return {status:"unavailable",message:"No saved payment method with customer authorization for future invoices. Send the customer the payment link."};
    if(automatic && customer.automaticPaymentAuthorizedAt>invoice.createdAt)
      return {status:"unavailable",message:"This invoice predates the customer's future-payment authorization. Staff review is required."};
    const rows=await tx.execute(sql`SELECT * FROM invoice_card_attempts WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    const previous=rows.rows[0] as unknown as Attempt|undefined;
    if(previous && ["checkout_open","checkout_creating"].includes(previous.status))return {status:"pending",message:"Customer checkout is open. Do not charge again."};
    if(previous && ["processing","returned","disputed"].includes(previous.status))return {status:"pending",message:previous.status==="processing"?"Bank payment is processing. Do not charge again.":"A bank payment was returned or disputed. Staff must reconcile it in Stripe before another charge."};
    if(previous?.status==="succeeded")return {status:"pending",message:"Payment was processed and is being reconciled. Do not charge again."};
    const cents=Math.round(invoiceBalance(invoice)*100);
    const saved=await stripe.paymentMethods.retrieve(customer.stripeDefaultPaymentMethodId);
    const owner=typeof saved.customer==="string"?saved.customer:saved.customer?.id;
    const methodType=saved.us_bank_account?"us_bank_account":saved.card?"card":null;
    if(owner!==customer.stripeCustomerId || !methodType)return {status:"unavailable",message:"Saved payment method could not be verified. Send the customer the secure payment link."};
    const allowed=allowedInvoiceMethods(readAchPolicy(company.paymentPolicy),cents);
    if(!allowed.includes(methodType)) {
      if(previous?.status==="reserved" && !previous.payment_intent_id)
        await tx.execute(sql`UPDATE invoice_card_attempts SET status='failed',updated_at=now() WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
      return {status:"unavailable",message:allowed.length===1 && allowed[0]==="us_bank_account"
        ?"ACH is required for this invoice amount. The saved card cannot be charged. Send the customer the secure invoice payment link."
        :"This saved bank account is not allowed for this invoice amount under the company payment rule. Send the customer the secure payment link."};
    }
    // An uncertain attempt must be reconciled with the SAME amount/method/key.
    if(previous && ["reserved","pending","unknown"].includes(previous.status) && previous.amount_cents!==cents)
      return {status:"pending",message:"A previous payment needs verification before changing or collecting this balance."};
    if(previous && ["reserved","pending","unknown"].includes(previous.status) && Date.now()-new Date(previous.reserved_at).getTime()>23*3600000)
      return {status:"pending",message:"This older payment must be verified in the payment provider before another charge."};
    if(previous?.status==="failed" && automatic)return {status:"failed",message:"Automatic payment failed. Staff review or customer payment is required."};
    if(!previous)return {status:"unavailable",message:"Payment reservation unavailable. Please retry."};
    const key=previous.attempt_key;
    const method=previous.payment_method_id!;
    await tx.execute(sql`INSERT INTO invoice_card_attempts(invoice_id,tenant_id,status,attempt_key,amount_cents,payment_method_id)
      VALUES(${invoiceId},${tenantId},'pending',${key},${cents},${method})
      ON CONFLICT(invoice_id) DO UPDATE SET status='pending',attempt_key=excluded.attempt_key,amount_cents=excluded.amount_cents,payment_method_id=excluded.payment_method_id,updated_at=now()`);
    try {
      const intent=await stripe.paymentIntents.create(previous.request_payload??{
        customer:customer.stripeCustomerId,payment_method:method,amount:cents,currency:"usd",
        confirm:true,off_session:true,payment_method_types:[methodType],description:`Invoice ${invoice.invoiceNumber}`,
        metadata:{invoiceId:String(invoiceId),tenantId:String(tenantId),source:"invoice_card"},
      },{idempotencyKey:key});
      if(intent.status!=="succeeded") {
        const failed=["requires_payment_method","requires_action","canceled"].includes(intent.status);
        await tx.execute(sql`UPDATE invoice_card_attempts SET status=${failed?"failed":intent.status==="processing"?"processing":"unknown"},payment_intent_id=${intent.id},updated_at=now() WHERE invoice_id=${invoiceId}`);
        return {status:failed?"failed":"pending",message:failed?"Payment needs a different payment method or customer authentication. Send the payment link.":"The provider is still processing payment. Bank payments can take up to four business days. Do not charge again."};
      }
      if(intent.amount_received!==cents || intent.currency!=="usd" || intent.customer!==customer.stripeCustomerId)
        throw new Error("Provider payment does not match invoice");
      await tx.update(invoicesTable).set({status:"paid",paidAt:new Date(),paymentMethod:methodType==="us_bank_account"?"ach":"card",paymentReference:intent.id})
        .where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId)));
      await tx.execute(sql`UPDATE invoice_card_attempts SET status='succeeded',payment_intent_id=${intent.id},error=NULL,updated_at=now() WHERE invoice_id=${invoiceId}`);
      await tx.insert(activityLogTable).values({tenantId,type:"payment_received",entityId:invoiceId,message:`Invoice ${invoice.invoiceNumber}: ${methodType==="us_bank_account"?"ACH":"card"} payment of $${(cents/100).toFixed(2)} processed successfully.`});
      return {status:"paid",message:"Payment processed successfully."};
    } catch(error) {
      const err=error as {type?:string;payment_intent?:{id:string;status:string}};
      const failed=err.type==="StripeCardError";
      await tx.execute(sql`UPDATE invoice_card_attempts SET status=${failed?"failed":"unknown"},payment_intent_id=${err.payment_intent?.id??null},
        error=${failed?"Card declined or customer authentication required":"Provider outcome needs verification"},updated_at=now() WHERE invoice_id=${invoiceId}`);
      await tx.insert(activityLogTable).values({tenantId,type:"invoice_payment_attention",entityId:invoiceId,message:`Invoice ${invoice.invoiceNumber}: ${failed?"card payment failed":"payment outcome is uncertain; do not retry with another payment method until verified"}. Staff follow-up required.`});
      return {status:failed?"failed":"pending",message:failed?"Card payment failed. The invoice remains unpaid.":"Payment outcome is not yet confirmed. Do not charge again until verified."};
    }
  });
}
