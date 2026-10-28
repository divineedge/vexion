import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { and, count, eq, sql } from "drizzle-orm";
import { frozenUserSlots, userSlotPolicy, slotPriceParams, subscriptionQuantity, verifySlotPrice } from "./softwareUserSlots";
import { db, plansTable, softwarePlanPricesTable, softwareBillingAccountsTable, tenantsTable, platformOwnersTable, usersTable, platformBillingAuditTable } from "@workspace/db";
import { validateFeatureKeys, SOFTWARE_POLICY_VERSION } from "./softwareFeatures";
import { getStripeClient } from "./stripe";
import { platformSettings,effectivePlatformFees } from "./platformBillingPolicy";

export const stripeId = (value: unknown): string | null => typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String(value.id) : null;
export async function isSoftwareOwner(userId: number, tenantId: number) {
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id,userId),eq(usersTable.tenantId,tenantId),eq(usersTable.isActive,true)));
  if (!user?.passwordHash || !/^\$2[aby]\$\d\d\$/.test(user.passwordHash)) return false;
  const [grant] = await db.select().from(platformOwnersTable).where(eq(platformOwnersTable.userId,userId));
  // Optional deployment bootstrap is an explicit immutable identity pair, NEVER an email signup claim.
  const configured = process.env.PLATFORM_OWNER_USER_ID === String(userId) && process.env.PLATFORM_OWNER_TENANT_ID === String(tenantId);
  return !!grant || configured;
}
export function audit(actorUserId: number | null, action: string, details: object) {
  return db.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId,action,details});
}
export async function liveStripe() {
  if (!(await platformSettings()).enabled) throw new Error("Live platform billing is paused. Drafts can be edited without charging anyone.");
  const stripe=getStripeClient(); if(!stripe) throw new Error("Stripe is not connected.");
  return stripe;
}
export const planDto = (p: typeof plansTable.$inferSelect) => ({ ...p, features:p.features??[],published: !!p.stripePriceId && p.revision===p.publishedRevision });
export async function ensureSoftwareAccount(tenantId: number) {
  await db.insert(softwareBillingAccountsTable).values({tenantId}).onConflictDoNothing();
  const [row]=await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  return row!;
}
export function accountDto(account: Awaited<ReturnType<typeof ensureSoftwareAccount>> | undefined,tenant: {id:number;name:string}) {
  const slots=frozenUserSlots(account?.planPolicy);
  return {tenantId:tenant.id,companyName:tenant.name,planId:account?.planId??null,status:account?.status??"none",
    additionalUserSlots:account?.additionalUserSlots??0,includedUsers:slots?.includedUsers??null,
    planPriceId:(account?.planPolicy as {priceId?:string}|null)?.priceId??null,purchasedBasePriceCents:slots?.basePriceCents??null,
    extraUserPriceCents:slots?.extraUserPriceCents??null,userSlotInterval:slots?.interval??null,
    cancelAtPeriodEnd:account?.cancelAtPeriodEnd??false,currentPeriodEnd:account?.currentPeriodEnd?.toISOString()??null,
    confirmedAt:account?.confirmedAt?.toISOString()??null,connectReady:account?.connectReady??false,
    hasConnectAccount:!!account?.connectAccountId,hasSubscription:!!account?.stripeSubscriptionId&&!["canceled","incomplete_expired"].includes(account.status)};
}
export async function publishSoftwarePlan(id:number,actor:number) {
  const [plan]=await db.select().from(plansTable).where(eq(plansTable.id,id));
  if(!plan)throw new Error("Plan not found");
  const featureKeys=validateFeatureKeys(plan.features??[]);
  const feePolicy={cardFeeBps:plan.cardFeeBps,cardFeeFixedCents:plan.cardFeeFixedCents,achFeeBps:plan.achFeeBps,achFeeFixedCents:plan.achFeeFixedCents,
    cardFeeMinCents:plan.cardFeeMinCents,cardFeeMaxCents:plan.cardFeeMaxCents,achFeeMinCents:plan.achFeeMinCents,achFeeMaxCents:plan.achFeeMaxCents};
  if(plan.revision===plan.publishedRevision && plan.stripePriceId)return planDto(plan);
  effectivePlatformFees({...plan,publishedFeePolicy:feePolicy},await platformSettings());
  const stripe=await liveStripe();
  const product=plan.stripeProductId??(await stripe.products.create({name:plan.name,metadata:{purpose:"software_subscription",planId:String(id)}},{idempotencyKey:`software-product-${id}`})).id;
  const userSlots=userSlotPolicy(plan);
  const price=await stripe.prices.create({product,...slotPriceParams(userSlots),currency:"usd",
    recurring:{interval:plan.billingInterval as "month"|"year"},metadata:{purpose:"software_subscription",planId:String(id),revision:String(plan.revision)}},
    {idempotencyKey:`software-price-${id}-${plan.revision}`});
  return db.transaction(async tx=>{
    if(plan.stripePriceId){
      // Preserve the policy in force for legacy subscribers before replacing
      // the published version. Their old price must not adopt draft features.
      const legacyPolicy=JSON.stringify({version:1,featureKeys:null,feePolicy:plan.publishedFeePolicy??{}});
      await tx.execute(sql`UPDATE software_plan_prices SET plan_policy=${legacyPolicy}::jsonb
        WHERE plan_id=${id} AND plan_policy IS NULL`);
      await tx.execute(sql`UPDATE software_billing_accounts SET plan_policy=${legacyPolicy}::jsonb
        WHERE plan_id=${id} AND stripe_subscription_id IS NOT NULL AND plan_policy IS NULL`);
    }
    await tx.insert(softwarePlanPricesTable).values({stripePriceId:price.id,planId:id,planPolicy:{version:SOFTWARE_POLICY_VERSION,featureKeys,feePolicy,userSlots,priceId:price.id}}).onConflictDoNothing();
    const [updated]=await tx.update(plansTable).set({stripeProductId:product,stripePriceId:price.id,publishedRevision:plan.revision,
      publishedFeePolicy:feePolicy})
      .where(and(eq(plansTable.id,id),eq(plansTable.revision,plan.revision))).returning();
    if(!updated)throw new Error("Plan changed while publishing. Publish the latest draft.");
    await tx.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId:actor,action:"plan_published",details:{planId:id,revision:plan.revision}});
    return planDto(updated);
  });
}
/** Always retrieve current provider state; old webhooks cannot restore an obsolete plan. */
export async function syncSoftwareSubscription(subscriptionId:string,stripeOverride?:Stripe) {
  const stripe=stripeOverride??getStripeClient();if(!stripe)throw new Error("Stripe is unavailable");
  return db.transaction(async serial=>{
  // Serialize retrieval as well as writes: concurrent quantity/payment webhooks
  // must never restore an older purchased-slot count after a newer one.
  await serial.execute(sql`SELECT pg_advisory_xact_lock(426982,hashtext(${subscriptionId}))`);
  const sub=await stripe.subscriptions.retrieve(subscriptionId,{expand:["latest_invoice"]});
  const customer=stripeId(sub.customer);if(!customer)throw new Error("Subscription has no customer");
  const [account]=await serial.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.stripeCustomerId,customer));
  if(!account || sub.metadata.purpose!=="software_subscription" || sub.metadata.tenantId!==String(account.tenantId))return;
  // A delayed event for a previously canceled subscription must not replace a new one.
  if(account.stripeSubscriptionId && account.stripeSubscriptionId!==sub.id){
    if(!["canceled","incomplete_expired"].includes(account.status) || !account.checkoutSessionId)return;
    const checkout=await stripe.checkout.sessions.retrieve(account.checkoutSessionId);
    if(stripeId(checkout.subscription)!==sub.id)return;
  }
  const first=sub.items.data[0]; const priceId=first?.price.id;
  const [mapped]=priceId?await serial.select().from(softwarePlanPricesTable).where(eq(softwarePlanPricesTable.stripePriceId,priceId)):[];
  if(!mapped || sub.items.data.length!==1)throw new Error("Subscription price is not an approved software plan");
  const slotPolicy=frozenUserSlots(mapped.planPolicy);
  let extraSlots=0;
  if(slotPolicy?.extraUserPriceCents!=null && slotPolicy.includedUsers!=null){
    const quantity=first.quantity;
    if(!Number.isInteger(quantity) || quantity!<slotPolicy.includedUsers)throw new Error("Subscription user quantity needs provider verification");
    extraSlots=quantity!-slotPolicy.includedUsers;
    let invoice=sub.latest_invoice;
    if(typeof invoice==="string")invoice=await stripe.invoices.retrieve(invoice);
    // A portal confirmation is not proof of payment. Keep unpaid slot
    // increases locked until Stripe confirms the associated invoice is paid.
    if(!["active","trialing"].includes(sub.status))extraSlots=0;
    else if(!invoice || invoice.status!=="paid")
      extraSlots=account.planId===mapped.planId?Math.min(account.additionalUserSlots,extraSlots):0;
  }
  await serial.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(426981,${account.tenantId})`);
    const [current]=await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,account.tenantId)).for("update");
    if(current.stripeSubscriptionId && current.stripeSubscriptionId!==sub.id && !["canceled","incomplete_expired"].includes(current.status))return;
    await tx.update(softwareBillingAccountsTable).set({stripeSubscriptionId:sub.id,planId:mapped.planId,status:sub.status,
      additionalUserSlots:extraSlots,cancelAtPeriodEnd:sub.cancel_at_period_end,currentPeriodEnd:first?.current_period_end?new Date(first.current_period_end*1000):null,confirmedAt:new Date()})
      .where(eq(softwareBillingAccountsTable.tenantId,account.tenantId));
    await tx.execute(sql`UPDATE software_billing_accounts SET plan_policy=${mapped.planPolicy==null?null:JSON.stringify(mapped.planPolicy)}::jsonb
      WHERE tenant_id=${account.tenantId}`);
    if(["active","trialing"].includes(sub.status)){
      const [plan]=await tx.select().from(plansTable).where(eq(plansTable.id,mapped.planId));
      if(plan)await tx.update(tenantsTable).set({planTier:plan.tier}).where(eq(tenantsTable.id,account.tenantId));
    }
  });
  });
}
export async function businessSubscriptionCheckout(tenantId:number,planId:number,returnUrl:string) {
  const stripe=await liveStripe();
  return db.transaction(async tx=>{
    await tx.insert(softwareBillingAccountsTable).values({tenantId}).onConflictDoNothing();
    let [account]=await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId)).for("update");
    if(account.stripeSubscriptionId && !["canceled","incomplete_expired"].includes(account.status))
      throw new Error("A subscription already exists. Use Manage subscription to change or cancel it.");
    const [plan]=await tx.select().from(plansTable).where(and(eq(plansTable.id,planId),eq(plansTable.active,true)));
    if(!plan?.stripePriceId || plan.revision!==plan.publishedRevision)throw new Error("This plan has not been published to Stripe");
    const price=await stripe.prices.retrieve(plan.stripePriceId,{expand:["tiers"]});
    verifySlotPrice(price,userSlotPolicy(plan));
    const [usage]=await tx.select({n:count()}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.isActive,true)));
    const quantity=subscriptionQuantity(userSlotPolicy(plan),Number(usage.n));
    if(account.checkoutSessionId){
      const existing=await stripe.checkout.sessions.retrieve(account.checkoutSessionId);
      if(existing.status==="complete" && !account.stripeSubscriptionId)throw new Error("Your subscription is being confirmed. Refresh before subscribing again.");
      if(existing.status==="open"){
        if(account.checkoutPlanId===planId && existing.url)return {url:existing.url};
        await stripe.checkout.sessions.expire(existing.id);
      }
    }
    if(account.checkoutKey && !account.checkoutSessionId && account.checkoutStartedAt && Date.now()-account.checkoutStartedAt.getTime()>23*3600000)
      throw new Error("An earlier subscription checkout needs provider review before retrying.");
    if(account.checkoutKey && !account.checkoutSessionId && account.checkoutPlanId!==planId)throw new Error("Retry the original subscription checkout first.");
    const key=account.checkoutKey && !account.checkoutSessionId?account.checkoutKey:`software-checkout-${tenantId}-${randomUUID()}`;
    const customer=account.stripeCustomerId??(await stripe.customers.create({metadata:{purpose:"software_subscription",tenantId:String(tenantId)}},{idempotencyKey:`software-customer-${tenantId}`})).id;
    await tx.update(softwareBillingAccountsTable).set({stripeCustomerId:customer,checkoutKey:key,
      checkoutStartedAt:key===account.checkoutKey?account.checkoutStartedAt:new Date(),checkoutPlanId:planId,
      checkoutSessionId:null,checkoutUrl:null}).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
    return {reservation:{key,customer,price:plan.stripePriceId,quantity,planId,tenantId,returnUrl}};
  }).then(async result=>{
    if("url" in result)return {url:result.url!};
    const r=result.reservation!;
    const session=await stripe.checkout.sessions.create({mode:"subscription",customer:r.customer,line_items:[{price:r.price,quantity:r.quantity}],
      payment_method_types:["card"],success_url:r.returnUrl+"?subscription=submitted",cancel_url:r.returnUrl,
      client_reference_id:String(tenantId),metadata:{purpose:"software_subscription",tenantId:String(tenantId)},
      subscription_data:{metadata:{purpose:"software_subscription",tenantId:String(tenantId)}}},{idempotencyKey:r.key});
    if(!session.url)throw new Error("Stripe did not return a checkout URL");
    await db.update(softwareBillingAccountsTable).set({checkoutSessionId:session.id,checkoutUrl:session.url})
      .where(and(eq(softwareBillingAccountsTable.tenantId,tenantId),eq(softwareBillingAccountsTable.checkoutKey,r.key)));
    return {url:session.url};
  });
}
