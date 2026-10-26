import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db, softwareBillingAccountsTable, usersTable, platformBillingAuditTable, taskNotificationsTable } from "@workspace/db";
import { stripeId, syncSoftwareSubscription } from "./softwareBilling";
import { recordPlatformReturn } from "./platformPayouts";

export async function handlePlatformBillingEvent(event:Stripe.Event):Promise<boolean>{
  const object=event.data.object as unknown as {id:string;mode?:string;subscription?:unknown;customer?:unknown;payment_intent?:unknown;
    amount?:number;amount_refunded?:number;refunded?:boolean;status?:string;metadata?:Record<string,string>;parent?:{subscription_details?:{subscription?:unknown}}};
  if(event.type==="charge.refunded" || event.type==="charge.dispute.created"){
    const intent=stripeId(object.payment_intent);
    if(intent)await recordPlatformReturn(intent,event.type==="charge.refunded"?!!object.refunded:!object.status?.startsWith("warning_"),object.amount);
    // Invoice return handling still runs in the existing document-payment path.
    return false;
  }
  let subscription:string|null=null;
  if(event.type.startsWith("customer.subscription."))subscription=object.id;
  else if(event.type==="invoice.paid" || event.type==="invoice.payment_failed")subscription=stripeId(object.parent?.subscription_details?.subscription??object.subscription);
  else if(event.type==="checkout.session.completed" && object.mode==="subscription" && object.metadata?.purpose==="software_subscription")subscription=stripeId(object.subscription);
  if(!subscription)return false;
  const customer=stripeId(object.customer);
  const [account]=customer?await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.stripeCustomerId,customer)):[];
  if(!account)return false;
  await syncSoftwareSubscription(subscription);
  await db.transaction(async tx=>{
    const inserted=await tx.insert(platformBillingAuditTable).values({id:event.id,action:`software_${event.type}`,details:{tenantId:account.tenantId,subscription}})
      .onConflictDoNothing().returning();
    if(!inserted.length || event.type!=="invoice.payment_failed")return;
    const owners=await tx.select().from(usersTable).where(and(eq(usersTable.tenantId,account.tenantId),eq(usersTable.role,"company_owner"),eq(usersTable.isActive,true)));
    for(const owner of owners)await tx.insert(taskNotificationsTable).values({tenantId:account.tenantId,recipientUserId:owner.id,type:"billing_review",
      message:"Your software subscription payment needs attention. Review payment details in Software billing.",linkPath:"/software-billing"});
  });
  return true;
}
