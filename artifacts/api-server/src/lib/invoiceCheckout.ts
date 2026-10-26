import { randomUUID } from "node:crypto";
import { db, invoicesTable, customersTable, tenantsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getStripeClient, ensureStripeCustomer } from "./stripe";
import { invoiceBalance } from "./customerCredit";
import { CARD_AUTHORIZATION_TERMS, CARD_AUTHORIZATION_VERSION } from "./cardAuthorization";
import type Stripe from "stripe";
import { allowedInvoiceMethods, getAchPolicy, PAYMENT_AUTHORIZATION_TERMS, PAYMENT_AUTHORIZATION_VERSION } from "./achPolicy";

export async function invoiceCheckout(tenantId:number,customerId:number,invoiceId:number,saveCard:boolean,returnUrl:string) {
  const stripe=getStripeClient();
  if(!stripe)throw new Error("Online payments are not configured. Contact the office.");
  const [company]=await db.select({enabled:tenantsTable.stripeEnabled}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  if(!company?.enabled)throw new Error("Online payments are not enabled for this company.");
  // Ensure customer outside the invoice lock (ensureStripeCustomer updates the customer row).
  const [payer]=await db.select().from(customersTable).where(and(eq(customersTable.id,customerId),eq(customersTable.tenantId,tenantId)));
  if(!payer)throw new Error("Customer not found");
  const customer=await ensureStripeCustomer(payer.id,payer.name,payer.email,payer.stripeCustomerId);
  const prepared=await db.transaction(async tx=>{
    const [invoice]=await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id,invoiceId),eq(invoicesTable.tenantId,tenantId),eq(invoicesTable.customerId,customerId))).for("update");
    if(!invoice || !["sent","overdue"].includes(invoice.status))throw new Error("Invoice is not payable");
    const cents=Math.round(invoiceBalance(invoice)*100);
    if(cents<=0)throw new Error("Invoice has no balance due");
    const methods=allowedInvoiceMethods(await getAchPolicy(tenantId),cents);
    const bankEnabled=methods.includes("us_bank_account");
    const attempts=await tx.execute(sql`SELECT * FROM invoice_card_attempts WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId}`);
    const attempt=attempts.rows[0] as {status:string;attempt_key:string;checkout_session_id:string;checkout_url:string;amount_cents:number;request_payload:Stripe.Checkout.SessionCreateParams;updated_at:Date}|undefined;
    if(attempt?.status==="checkout_creating"){
      if(attempt.amount_cents!==cents || attempt.request_payload?.metadata?.saveCard!==(saveCard?"true":"false") ||
        JSON.stringify(attempt.request_payload?.payment_method_types)!==JSON.stringify(methods) ||
        Date.now()-new Date(attempt.updated_at).getTime()>23*3600000)throw new Error("An earlier checkout needs verification before starting another payment.");
      return {key:attempt.attempt_key,payload:attempt.request_payload};
    }
    if(attempt?.status==="checkout_open"){
      const session=await stripe.checkout.sessions.retrieve(attempt.checkout_session_id);
      if(session.status==="open")await stripe.checkout.sessions.expire(session.id);
      else if(session.status!=="expired")throw new Error("Payment is being confirmed. Refresh before trying again.");
    } else if(attempt && ["reserved","pending","processing","unknown","succeeded","returned","disputed"].includes(attempt.status))throw new Error("A previous payment needs verification. Do not pay again.");
    const key=`checkout-invoice-${invoiceId}-${randomUUID()}`;
    const consent={invoiceId:String(invoiceId),tenantId:String(tenantId),saveCard:saveCard?"true":"false",
      authorizationVersion:saveCard?(bankEnabled?PAYMENT_AUTHORIZATION_VERSION:CARD_AUTHORIZATION_VERSION):"none",authorizationAcceptedAt:saveCard?new Date().toISOString():""};
    const payload:Stripe.Checkout.SessionCreateParams={
      mode:"payment",customer,payment_method_types:methods,
      ...(bankEnabled?{payment_method_options:{us_bank_account:{verification_method:"automatic" as const}}}:{}),
      line_items:[{price_data:{currency:"usd",unit_amount:cents,product_data:{name:`Invoice ${invoice.invoiceNumber}`}},quantity:1}],
      success_url:`${returnUrl}${returnUrl.includes("?")?"&":"?"}payment=success`,cancel_url:returnUrl,
      metadata:consent,payment_intent_data:{...(saveCard?{setup_future_usage:"off_session" as const}:{}),metadata:consent},
      custom_text:{submit:{message:saveCard?(bankEnabled?PAYMENT_AUTHORIZATION_TERMS:CARD_AUTHORIZATION_TERMS):"One-time payment only. This payment method will not be saved for future invoices."}},
    };
    await tx.execute(sql`INSERT INTO invoice_card_attempts(invoice_id,tenant_id,status,attempt_key,amount_cents,request_payload)
      VALUES(${invoiceId},${tenantId},'checkout_creating',${key},${cents},${JSON.stringify(payload)}::jsonb)
      ON CONFLICT(invoice_id) DO UPDATE SET status='checkout_creating',attempt_key=excluded.attempt_key,amount_cents=excluded.amount_cents,
      request_payload=excluded.request_payload,checkout_session_id=NULL,checkout_url=NULL,checkout_authorization_saved=false,reserved_at=now(),updated_at=now()`);
    return {key,payload};
  });
  const session=await stripe.checkout.sessions.create(prepared.payload,{idempotencyKey:prepared.key});
  if(!session.url)throw new Error("Payment provider did not return a checkout link");
  await db.execute(sql`UPDATE invoice_card_attempts SET status='checkout_open',checkout_session_id=${session.id},checkout_url=${session.url},updated_at=now()
    WHERE invoice_id=${invoiceId} AND tenant_id=${tenantId} AND attempt_key=${prepared.key}`);
  return {checkoutUrl:session.url};
}
