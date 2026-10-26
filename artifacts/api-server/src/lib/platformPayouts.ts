import type Stripe from "stripe";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, platformPaymentAllocationsTable as allocations, softwareBillingAccountsTable } from "@workspace/db";
import { getStripeClient } from "./stripe";
import { stripeId } from "./softwareBilling";
import { logger } from "./logger";

export const payoutDto=(r:typeof allocations.$inferSelect)=>({...r,createdAt:r.createdAt.toISOString()});
export async function recordPlatformPayment(paymentIntentId:string) {
  const stripe=getStripeClient();if(!stripe)throw new Error("Stripe unavailable");
  const pi=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:["latest_charge.balance_transaction"]});
  const m=pi.metadata;if(m.platform_payments!=="v1" || pi.status!=="succeeded")return;
  const charge=pi.latest_charge as Stripe.Charge|null;
  if(!charge || typeof charge==="string")throw new Error("Payment charge not confirmed");
  const tenantId=Number(m.platform_tenant);
  const [account]=await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  if(!account || account.connectAccountId!==m.platform_destination || pi.currency!=="usd" || String(pi.amount_received)!==m.platform_amount)
    throw new Error("Payment payout identity mismatch");
  const fee=Number(charge.payment_method_details?.type==="us_bank_account"?m.platform_ach_fee:m.platform_card_fee);
  if(!Number.isSafeInteger(fee) || fee<0 || fee>pi.amount_received)throw new Error("Invalid snapshotted platform fee");
  await db.insert(allocations).values({paymentIntentId:pi.id,tenantId,connectAccountId:account.connectAccountId,
    amountCents:pi.amount_received,requestedFeeCents:fee,status:charge.disputed?"review":"pending",
    lastError:charge.disputed?"Disputed payment requires provider review.":null}).onConflictDoNothing();
}
/** Signature verification belongs to the caller. No transfer is made from a browser success URL. */
export async function recordPlatformReturn(paymentIntentId:string,full:boolean,returnedAmount?:number) {
  const [existing]=await db.select().from(allocations).where(eq(allocations.paymentIntentId,paymentIntentId));
  if(!existing)return;
  if(returnedAmount!==undefined && returnedAmount<existing.amountCents)full=false;
  if(!full){
    await db.update(allocations).set({status:"review",lastError:"Partial refund or dispute: reconcile the business payout in Stripe before further action."})
      .where(and(eq(allocations.paymentIntentId,paymentIntentId),eq(allocations.reverseRequested,false)));
    return;
  }
  await db.update(allocations).set({reverseRequested:true,status:"reversal_pending",attemptedAt:new Date(),lastError:null})
    .where(and(eq(allocations.paymentIntentId,paymentIntentId),eq(allocations.reverseRequested,false)));
}
export async function processPlatformPayout(paymentIntentId:string) {
  const stripe=getStripeClient();if(!stripe)throw new Error("Stripe unavailable");
  // Persist the first provider-attempt time before making any financial API call.
  await db.update(allocations).set({attemptedAt:new Date()}).where(and(eq(allocations.paymentIntentId,paymentIntentId),isNull(allocations.attemptedAt)));
  return db.transaction(async tx=>{
    const [row]=await tx.select().from(allocations).where(eq(allocations.paymentIntentId,paymentIntentId)).for("update");
    if(!row)throw new Error("Payout not found");
    if(["transferred","reversed","review"].includes(row.status))return payoutDto(row);
    if(row.attemptedAt && Date.now()-row.attemptedAt.getTime()>23*3600000){
      const [held]=await tx.update(allocations).set({status:"review",lastError:"Provider idempotency window expired. Verify transfer history in Stripe; do not issue a new transfer blindly."}).where(eq(allocations.paymentIntentId,paymentIntentId)).returning();
      return payoutDto(held);
    }
    try{
      if(row.reverseRequested){
        if(row.transferId){
          const transfer=await stripe.transfers.retrieve(row.transferId);
          if(transfer.destination!==row.connectAccountId || transfer.amount!==row.payoutCents)throw new Error("Transfer identity mismatch");
          const remaining=transfer.amount-transfer.amount_reversed;
          if(remaining>0)await stripe.transfers.createReversal(row.transferId,{amount:remaining,metadata:{paymentIntentId}},{idempotencyKey:`platform-return-${paymentIntentId}`});
        }
        const [updated]=await tx.update(allocations).set({status:"reversed",lastError:null}).where(eq(allocations.paymentIntentId,paymentIntentId)).returning();
        return payoutDto(updated);
      }
      const pi=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:["latest_charge.balance_transaction"]});
      const charge=pi.latest_charge as Stripe.Charge|null;
      if(pi.status!=="succeeded" || pi.amount_received!==row.amountCents || pi.currency!=="usd" ||
        pi.metadata.platform_destination!==row.connectAccountId || pi.metadata.platform_tenant!==String(row.tenantId))throw new Error("Payment identity requires review");
      if(!charge || typeof charge==="string" || !charge.paid)throw new Error("Payment charge not yet confirmed");
      if(charge.disputed || charge.amount_refunded>0){
        const [held]=await tx.update(allocations).set({status:"review",lastError:"Refunded or disputed charge requires payout reconciliation."}).where(eq(allocations.paymentIntentId,paymentIntentId)).returning();
        return payoutDto(held);
      }
      const balance=charge.balance_transaction;
      if(!balance || typeof balance==="string")throw new Error("Stripe processing fee is not yet available");
      if(balance.currency!=="usd" || balance.fee<0 || !Number.isSafeInteger(balance.fee))throw new Error("Unsupported processor fee");
      const platformFee=Math.min(row.requestedFeeCents,Math.max(0,row.amountCents-balance.fee));
      const payout=Math.max(0,row.amountCents-balance.fee-platformFee);
      const transfer=payout>0?await stripe.transfers.create({amount:payout,currency:"usd",destination:row.connectAccountId,
        source_transaction:charge.id,transfer_group:`platform_${pi.id}`,metadata:{paymentIntentId:pi.id,tenantId:String(row.tenantId)}},
        {idempotencyKey:`platform-payout-${pi.id}`}):null;
      const [updated]=await tx.update(allocations).set({processorFeeCents:balance.fee,platformFeeCents:platformFee,
        payoutCents:payout,transferId:transfer?.id??null,status:"transferred",lastError:null}).where(eq(allocations.paymentIntentId,paymentIntentId)).returning();
      return payoutDto(updated);
    }catch(error){
      logger.warn({paymentIntentId,errorType:(error as {type?:string}).type??"payout_unconfirmed"},"Platform payout needs verification or retry");
      const [updated]=await tx.update(allocations).set({lastError:"Stripe payout or reversal is unconfirmed. The same provider reference will be retried; no new payment is charged."}).where(eq(allocations.paymentIntentId,paymentIntentId)).returning();
      return payoutDto(updated);
    }
  });
}
let busy=false;
export async function processPendingPlatformPayouts(){
  if(busy)return;busy=true;
  try{
    const pending=await db.select().from(allocations).where(inArray(allocations.status,["pending","reversal_pending"])).orderBy(allocations.createdAt).limit(25);
    for(const item of pending)await processPlatformPayout(item.paymentIntentId);
  }catch(error){logger.warn({errorType:(error as {name?:string}).name},"Platform payout queue deferred");}finally{busy=false;}
}
export function startPlatformPayouts(){const timer=setInterval(()=>void processPendingPlatformPayouts(),60_000);timer.unref();}
