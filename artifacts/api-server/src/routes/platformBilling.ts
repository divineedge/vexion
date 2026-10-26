import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, plansTable, platformBillingSettingsTable, softwareBillingAccountsTable, tenantsTable, usersTable,
  platformPaymentAllocationsTable, platformBillingAuditTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isSoftwareOwner, audit, liveStripe, planDto, accountDto, ensureSoftwareAccount, publishSoftwarePlan,
  businessSubscriptionCheckout, syncSoftwareSubscription, stripeId } from "../lib/softwareBilling";
import { platformSettings, platformSettingsInput, softwarePlanInput, effectivePlatformFees } from "../lib/platformBillingPolicy";
import { payoutDto, processPlatformPayout } from "../lib/platformPayouts";

const router=Router();
const action=(handler:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response)=>{
  try{await handler(req,res);}catch(error){
    if(error instanceof z.ZodError){res.status(400).json({error:error.issues[0]?.message??"Invalid input"});return;}
    req.log?.warn({errorType:(error as {name?:string}).name},"Software billing action could not be confirmed");
    const message=error instanceof Error && error.constructor===Error?error.message:"Stripe or billing storage is unavailable. No new charge is confirmed.";
    res.status(409).json({error:message});
  }
};
const idParam=z.coerce.number().int().positive();
const billingUrl=(req:Request)=>{
  const candidate=req.get("origin")??`${req.get("x-forwarded-proto")==="https"?"https":req.protocol}://${req.get("host")}`;
  const url=new URL(candidate);
  if(url.username || url.password || (url.protocol!=="https:" && url.hostname!=="localhost" && url.hostname!=="127.0.0.1"))throw new Error("Secure browser origin is required");
  return url.origin+"/software-billing";
};
router.get("/platform-billing/access",action(async(req,res)=>{
  res.json({isSoftwareOwner:await isSoftwareOwner(getUserId(req),getTenantId(req))});
}));
router.use("/platform-billing",async(req:Request,res:Response,next:NextFunction)=>{
  if(!await isSoftwareOwner(getUserId(req),getTenantId(req))){res.status(403).json({error:"Software-owner access required"});return;}next();
});
router.use("/software-billing",async(req:Request,res:Response,next:NextFunction)=>{
  const [user]=await db.select().from(usersTable).where(eq(usersTable.id,getUserId(req)));
  if(user?.role!=="company_owner"){res.status(403).json({error:"Business-owner access required"});return;}next();
});
async function businessView(tenantId:number){
  const account=await ensureSoftwareAccount(tenantId);
  const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  const settings=await platformSettings();
  const plans=await db.select().from(plansTable).where(eq(plansTable.active,true));
  const [currentPlan]=account.planId && account.stripeSubscriptionId && ["active","trialing"].includes(account.status)
    ?await db.select().from(plansTable).where(eq(plansTable.id,account.planId)):[];
  const payouts=await db.select().from(platformPaymentAllocationsTable).where(eq(platformPaymentAllocationsTable.tenantId,tenantId)).orderBy(desc(platformPaymentAllocationsTable.createdAt)).limit(100);
  return {enabled:settings.enabled,account:accountDto(account,tenant),plans:plans.map(planDto).filter(p=>p.published),
    payouts:payouts.map(payoutDto),fees:effectivePlatformFees(currentPlan,settings)};
}
router.get("/platform-billing/admin",action(async(_req,res)=>{
  const plans=await db.select().from(plansTable).orderBy(plansTable.price);
  const businesses=await db.select({tenant:tenantsTable,account:softwareBillingAccountsTable}).from(tenantsTable)
    .leftJoin(softwareBillingAccountsTable,eq(tenantsTable.id,softwareBillingAccountsTable.tenantId));
  const payouts=await db.select().from(platformPaymentAllocationsTable).orderBy(desc(platformPaymentAllocationsTable.createdAt)).limit(200);
  const history=await db.select({action:platformBillingAuditTable.action,createdAt:platformBillingAuditTable.createdAt}).from(platformBillingAuditTable).orderBy(desc(platformBillingAuditTable.createdAt)).limit(100);
  res.json({settings:await platformSettings(),plans:plans.map(planDto),businesses:businesses.map(b=>accountDto(b.account??undefined,b.tenant)),
    payouts:payouts.map(payoutDto),audit:history.map(a=>({...a,createdAt:a.createdAt.toISOString()}))});
}));
router.patch("/platform-billing/settings",action(async(req,res)=>{
  const input=platformSettingsInput.parse(req.body);const {confirmActivation,...values}=input;
  if(values.enabled && !(await platformSettings()).enabled){
    if(!confirmActivation)throw new Error("Confirm activation: businesses must finish Stripe Connect setup before accepting new online payments.");
    // Authentication and capabilities must actually work; a configured-looking key is not readiness.
    const {getStripeClient}=await import("../lib/stripe");const stripe=getStripeClient();
    if(!stripe)throw new Error("Connect Stripe before activating platform billing.");
    await stripe.accounts.retrieve(null);
  }
  await db.transaction(async tx=>{
    await tx.insert(platformBillingSettingsTable).values({id:1,...values}).onConflictDoUpdate({target:platformBillingSettingsTable.id,set:values});
    await tx.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId:getUserId(req),action:"platform_fee_settings_changed",details:values});
  });
  res.json(values);
}));
router.post("/platform-billing/plans",action(async(req,res)=>{
  const input=softwarePlanInput.parse(req.body);
  const [plan]=await db.insert(plansTable).values(input).returning();
  await audit(getUserId(req),"plan_created",{planId:plan.id});res.status(201).json(planDto(plan));
}));
router.patch("/platform-billing/plans/:id",action(async(req,res)=>{
  const id=idParam.parse(req.params.id),input=softwarePlanInput.parse(req.body);
  const [plan]=await db.update(plansTable).set({...input,revision:sql`${plansTable.revision}+1`}).where(eq(plansTable.id,id)).returning();
  if(!plan){res.status(404).json({error:"Plan not found"});return;}
  await audit(getUserId(req),"plan_draft_updated",{planId:id,revision:plan.revision});res.json(planDto(plan));
}));
router.post("/platform-billing/plans/:id/publish",action(async(req,res)=>{res.json(await publishSoftwarePlan(idParam.parse(req.params.id),getUserId(req)));}));
router.post("/platform-billing/payouts/:id/retry",action(async(req,res)=>{
  const id=z.string().regex(/^pi_[a-zA-Z0-9_]+$/).parse(req.params.id);
  const result=await processPlatformPayout(id);await audit(getUserId(req),"payout_retry",{paymentIntentId:id,status:result.status});res.json(result);
}));
router.get("/software-billing",action(async(req,res)=>{res.json(await businessView(getTenantId(req)));}));
router.post("/software-billing/subscribe",action(async(req,res)=>{
  const input=z.object({planId:idParam}).strict().parse(req.body);
  res.json(await businessSubscriptionCheckout(getTenantId(req),input.planId,billingUrl(req)));
}));
router.post("/software-billing/manage",action(async(req,res)=>{
  const stripe=await liveStripe(),tenantId=getTenantId(req);
  const {planId}=z.object({planId:idParam.optional()}).strict().parse(req.body??{});
  const account=await ensureSoftwareAccount(tenantId);
  if(!account.stripeCustomerId || !account.stripeSubscriptionId)throw new Error("No software subscription to manage");
  const products=await db.select().from(plansTable).where(and(eq(plansTable.active,true),sql`${plansTable.publishedRevision}=${plansTable.revision}`));
  const configKey=createHash("sha256").update(JSON.stringify(products.map(p=>[p.stripeProductId,p.stripePriceId]).sort())).digest("hex").slice(0,32);
  const config=await stripe.billingPortal.configurations.create({business_profile:{headline:"Manage your software subscription"},
    features:{customer_update:{enabled:true,allowed_updates:["address","tax_id"]},invoice_history:{enabled:true},payment_method_update:{enabled:true},
      subscription_cancel:{enabled:true,mode:"at_period_end"},
      subscription_update:{enabled:products.length>0,default_allowed_updates:["price"],proration_behavior:"create_prorations",
        products:products.filter(p=>p.stripeProductId&&p.stripePriceId).map(p=>({product:p.stripeProductId!,prices:[p.stripePriceId!]}))}}},
        {idempotencyKey:`software-portal-config-${configKey}`});
  let flow:import("stripe").default.BillingPortal.SessionCreateParams.FlowData|undefined;
  if(planId){
    const plan=products.find(p=>p.id===planId);if(!plan?.stripePriceId)throw new Error("Selected plan is not published");
    const sub=await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
    if(stripeId(sub.customer)!==account.stripeCustomerId || sub.metadata.tenantId!==String(tenantId))throw new Error("Subscription ownership mismatch");
    flow={type:"subscription_update_confirm",subscription_update_confirm:{subscription:sub.id,items:[{id:sub.items.data[0].id,price:plan.stripePriceId,quantity:1}]}};
  }
  const session=await stripe.billingPortal.sessions.create({customer:account.stripeCustomerId,configuration:config.id,return_url:billingUrl(req),...(flow?{flow_data:flow}:{})});
  res.json({url:session.url});
}));
router.post("/software-billing/connect",action(async(req,res)=>{
  z.object({acceptedTerms:z.literal(true)}).strict().parse(req.body);
  const stripe=await liveStripe(),tenantId=getTenantId(req);
  const account=await db.transaction(async tx=>{
    await tx.insert(softwareBillingAccountsTable).values({tenantId}).onConflictDoNothing();
    const [row]=await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId)).for("update");
    if(row.connectAccountId)return row;
    if(row.connectStartedAt && Date.now()-row.connectStartedAt.getTime()>23*3600000)throw new Error("Earlier payout-account setup needs provider verification before retrying.");
    const [updated]=await tx.update(softwareBillingAccountsTable).set({connectCreateKey:row.connectCreateKey??`connect-${tenantId}-${randomUUID()}`,
      connectStartedAt:row.connectStartedAt??new Date(),termsAcceptedAt:new Date()}).where(eq(softwareBillingAccountsTable.tenantId,tenantId)).returning();
    return updated;
  });
  let destination=account.connectAccountId;
  if(!destination){
    destination=(await stripe.accounts.create({type:"express",country:"US",capabilities:{transfers:{requested:true}},
      metadata:{purpose:"business_payout",tenantId:String(tenantId)}},{idempotencyKey:account.connectCreateKey!})).id;
    await db.update(softwareBillingAccountsTable).set({connectAccountId:destination}).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  }
  await db.update(softwareBillingAccountsTable).set({termsAcceptedAt:new Date()}).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  const link=await stripe.accountLinks.create({account:destination,type:"account_onboarding",refresh_url:billingUrl(req)+"?connect=refresh",return_url:billingUrl(req)+"?connect=submitted"});
  await audit(getUserId(req),"business_payout_onboarding",{tenantId});res.json({url:link.url});
}));
router.post("/software-billing/refresh",action(async(req,res)=>{
  const stripe=await liveStripe(),tenantId=getTenantId(req),account=await ensureSoftwareAccount(tenantId);
  if(account.connectAccountId){
    const remote=await stripe.accounts.retrieve(account.connectAccountId);
    if(remote.metadata?.tenantId!==String(tenantId) || remote.metadata?.purpose!=="business_payout")throw new Error("Payout account ownership mismatch");
    await db.update(softwareBillingAccountsTable).set({connectReady:!!remote.details_submitted&&!!remote.payouts_enabled&&remote.capabilities?.transfers==="active"}).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  }
  let subscription=account.stripeSubscriptionId;
  if(account.checkoutSessionId){
    const checkout=await stripe.checkout.sessions.retrieve(account.checkoutSessionId);
    if(stripeId(checkout.customer)!==account.stripeCustomerId || checkout.metadata?.tenantId!==String(tenantId))throw new Error("Subscription checkout ownership mismatch");
    subscription=stripeId(checkout.subscription)??subscription;
  }
  if(subscription)await syncSoftwareSubscription(subscription,stripe);
  res.json(await businessView(tenantId));
}));
export default router;
