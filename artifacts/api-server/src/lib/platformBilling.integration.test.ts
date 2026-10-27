import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import request from "supertest";
import type Stripe from "stripe";
const state=vi.hoisted(()=>({connection:null as any,stripe:null as any,userId:0,tenantId:0,intent:null as any}));
vi.mock("@workspace/db",async original=>{
  const module=await original<typeof import("@workspace/db")>();
  return {...module,db:new Proxy(module.db,{get(target,key){const current=state.connection??target,value=current[key];return typeof value==="function"?value.bind(current):value;}})};
});
vi.mock("./stripe",()=>({getStripeClient:()=>state.stripe}));
import { db,pool,tenantsTable,usersTable,platformOwnersTable,platformBillingSettingsTable as config,
  softwareBillingAccountsTable as accounts,plansTable,softwarePlanPricesTable,platformPaymentAllocationsTable as allocations } from "@workspace/db";
import { eq,sql } from "drizzle-orm";
import router from "../routes/platformBilling";
import publishedPlansRouter from "../routes/plans";
import { feeCents,platformPaymentMetadata,softwarePlanInput } from "./platformBillingPolicy";
import { recordPlatformPayment,processPlatformPayout,recordPlatformReturn } from "./platformPayouts";
import { businessSubscriptionCheckout,syncSoftwareSubscription,publishSoftwarePlan,isSoftwareOwner } from "./softwareBilling";
import { handlePlatformBillingEvent } from "./platformBillingEvents";

describe("software-owner billing and proceeds",()=>{
  const connect=()=>pool.connect();let client:Awaited<ReturnType<typeof connect>>,savepoint=0,tenantId=0,ownerId=0,businessOwnerId=0,planId=0;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{
    Object.assign(req,{verifiedTenantId:state.tenantId,verifiedUserId:state.userId});next();
  });app.use(router);app.use(publishedPlansRouter);
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    const raw=drizzle(client);
    state.connection=new Proxy(raw,{get(target,key){
      if(key==="transaction")return async(callback:(tx:any)=>Promise<unknown>)=>{
        const name=`platform_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);
        try{const result=await callback(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
        catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}
      };
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
    const [tenant]=await db.insert(tenantsTable).values({name:"Rollback-only software billing fixture"}).returning();tenantId=tenant.id;
    const hash="$2b$10$"+"a".repeat(53);
    const [owner]=await db.insert(usersTable).values({tenantId,name:"Fixture platform owner",email:`platform-${tenantId}@example.invalid`,role:"company_owner",passwordHash:hash}).returning();ownerId=owner.id;
    const [businessOwner]=await db.insert(usersTable).values({tenantId,name:"Fixture business owner",email:`business-${tenantId}@example.invalid`,role:"company_owner",passwordHash:hash}).returning();businessOwnerId=businessOwner.id;
    await db.insert(platformOwnersTable).values({userId:owner.id});
    await db.insert(config).values({id:1,enabled:false,cardFeeBps:200,cardFeeFixedCents:30,achFeeBps:100,achFeeFixedCents:0})
      .onConflictDoUpdate({target:config.id,set:{enabled:false,cardFeeBps:200,cardFeeFixedCents:30,achFeeBps:100,achFeeFixedCents:0}});
    const [plan]=await db.insert(plansTable).values({name:"Fixture software plan",tier:"fixture",price:129,billingInterval:"month",revision:1,publishedRevision:1,stripePriceId:"price_fixture",stripeProductId:"prod_fixture",features:["scheduling","invoices"],active:true}).returning();planId=plan.id;
    await db.insert(softwarePlanPricesTable).values({stripePriceId:"price_fixture",planId}).onConflictDoNothing();
    await db.insert(accounts).values({tenantId,stripeCustomerId:`cus_software_${tenantId}`,planId,connectAccountId:`acct_${tenantId}`,connectReady:true,termsAcceptedAt:new Date()});
  });
  beforeEach(async()=>{
    await client.query("SAVEPOINT test_case");state.tenantId=tenantId;state.userId=ownerId;
    state.intent={id:"pi_fixture",status:"succeeded",currency:"usd",amount_received:10000,metadata:{
      platform_payments:"v1",platform_destination:`acct_${tenantId}`,platform_tenant:String(tenantId),platform_amount:"10000",
      platform_card_fee:"500",platform_ach_fee:"100"},latest_charge:{id:"ch_fixture",paid:true,amount:10000,amount_refunded:0,disputed:false,
      payment_method_details:{type:"card"},balance_transaction:{id:"txn_fixture",currency:"usd",fee:320}}};
    const sub={id:"sub_fixture",customer:`cus_software_${tenantId}`,status:"active",cancel_at_period_end:false,
      metadata:{purpose:"software_subscription",tenantId:String(tenantId)},items:{data:[{id:"si_fixture",current_period_end:1800000000,price:{id:"price_fixture"}}]}};
    state.stripe={paymentIntents:{retrieve:vi.fn(async()=>state.intent)},transfers:{
      create:vi.fn(async(params:any)=>({id:"tr_fixture",...params})),
      retrieve:vi.fn(async()=>({id:"tr_fixture",amount:9180,amount_reversed:0,destination:`acct_${tenantId}`})),
      createReversal:vi.fn(async()=>({id:"trr_fixture"}))},
      subscriptions:{retrieve:vi.fn(async()=>sub)},customers:{create:vi.fn(async()=>({id:`cus_software_${tenantId}`}))},
      products:{create:vi.fn(async()=>({id:"prod_created"}))},prices:{
        create:vi.fn(async()=>({id:"price_published"})),retrieve:vi.fn(async()=>({id:"price_fixture",active:true,currency:"usd",unit_amount:12900,recurring:{interval:"month"}}))},
      billingPortal:{configurations:{create:vi.fn(async()=>({id:"bpc_fixture"}))},sessions:{create:vi.fn(async()=>({url:"https://billing.stripe.com/p/session/test"}))}},
      accountLinks:{create:vi.fn(async()=>({url:"https://connect.stripe.com/setup/test"}))},
      checkout:{sessions:{create:vi.fn(async()=>({id:"cs_fixture",url:"https://checkout.stripe.com/c/pay/test"})),
        retrieve:vi.fn(async()=>({id:"cs_fixture",status:"open",url:"https://checkout.stripe.com/c/pay/test",customer:`cus_software_${tenantId}`})),
        expire:vi.fn(async()=>({id:"cs_fixture"}))}},accounts:{retrieve:vi.fn(async()=>({id:"acct_platform"})),create:vi.fn(async()=>({id:`acct_${tenantId}`}))}};
  });
  afterEach(async()=>{await client.query("ROLLBACK TO SAVEPOINT test_case");await client.query("RELEASE SAVEPOINT test_case");});
  afterAll(async()=>{try{await client.query("ROLLBACK");}finally{state.connection=null;client.release();await pool.end();}});
  it("rounds percentage fees in cents and caps the platform fee to received funds",()=>{
    expect(feeCents(10000,200,30)).toBe(230);expect(feeCents(1,10000,1000)).toBe(1);
    expect(()=>feeCents(1.2,100,0)).toThrow();expect(feeCents(0,100,30)).toBe(0);
  });
  it("rejects malformed prices, negative fees, and caller-supplied provider IDs",()=>{
    const input={name:"A",tier:"a",price:1.001,billingInterval:"month",active:true,features:[],maxUsers:null,maxProperties:null,cardFeeBps:null,cardFeeFixedCents:null,achFeeBps:null,achFeeFixedCents:null};
    expect(softwarePlanInput.safeParse(input).success).toBe(false);
    expect(softwarePlanInput.safeParse({...input,price:10,cardFeeBps:-1}).success).toBe(false);
    expect(softwarePlanInput.safeParse({...input,price:10,stripePriceId:"price_attack"}).success).toBe(false);
  });
  it("does not elevate ordinary business owners or trust a forged owner field",async()=>{
    state.userId=businessOwnerId;
    expect((await request(app).get("/platform-billing/access")).body.isSoftwareOwner).toBe(false);
    expect((await request(app).get("/platform-billing/admin")).status).toBe(403);
    expect((await request(app).patch("/platform-billing/settings").send({isSoftwareOwner:true,enabled:true})).status).toBe(403);
  });
  it("binds deployment owner access to the exact active user and company",async()=>{
    try{
      vi.stubEnv("PLATFORM_OWNER_USER_ID",String(businessOwnerId));
      vi.stubEnv("PLATFORM_OWNER_TENANT_ID",String(tenantId));
      expect(await isSoftwareOwner(businessOwnerId,tenantId)).toBe(true);
      expect(await isSoftwareOwner(businessOwnerId,tenantId+1000000)).toBe(false);
      vi.stubEnv("PLATFORM_OWNER_USER_ID",String(businessOwnerId+1000000));
      expect(await isSoftwareOwner(businessOwnerId,tenantId)).toBe(false);
    }finally{vi.unstubAllEnvs();}
  });
  it("rejects demo-password accounts even with a platform grant",async()=>{
    await db.update(usersTable).set({passwordHash:"mock"}).where(eq(usersTable.id,ownerId));
    expect((await request(app).get("/platform-billing/admin")).status).toBe(403);
  });
  it("persists owner fee settings but requires explicit activation confirmation",async()=>{
    const settings={enabled:false,cardFeeBps:350,cardFeeFixedCents:25,achFeeBps:80,achFeeFixedCents:10};
    expect((await request(app).patch("/platform-billing/settings").send(settings)).status).toBe(200);
    expect((await request(app).get("/platform-billing/admin")).body.settings.cardFeeBps).toBe(350);
    expect((await request(app).patch("/platform-billing/settings").send({...settings,enabled:true})).status).toBe(409);
    expect(state.stripe.accounts.retrieve).not.toHaveBeenCalled();
  });
  it("allows confirmed activation only after a real provider authentication check",async()=>{
    const settings={enabled:true,confirmActivation:true,cardFeeBps:200,cardFeeFixedCents:0,achFeeBps:100,achFeeFixedCents:0};
    expect((await request(app).patch("/platform-billing/settings").send(settings)).status).toBe(200);
    expect(state.stripe.accounts.retrieve).toHaveBeenCalledWith(null);
  });
  it("snapshots distinct card/ACH fees without changing the received amount",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    const metadata=await platformPaymentMetadata(tenantId,10000);
    expect(metadata.platform_card_fee).toBe("230");expect(metadata.platform_ach_fee).toBe("100");expect(metadata.platform_amount).toBe("10000");
  });
  it("keeps business payouts running with zero new platform fees when monetization is paused",async()=>{
    const metadata=await platformPaymentMetadata(tenantId,10000);
    expect(metadata.platform_card_fee).toBe("0");expect(metadata.platform_destination).toBe(`acct_${tenantId}`);
  });
  it("blocks fee-enabled payments until the actual business payout setup is ready",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await db.update(accounts).set({connectReady:false}).where(eq(accounts.tenantId,tenantId));
    await expect(platformPaymentMetadata(tenantId,1000)).rejects.toThrow("payout setup");
  });
  it("uses published plan fee overrides, never an unpublished draft fee change",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await db.update(accounts).set({status:"active",stripeSubscriptionId:"sub_fixture"}).where(eq(accounts.tenantId,tenantId));
    await db.update(plansTable).set({cardFeeBps:900,publishedFeePolicy:{cardFeeBps:100,cardFeeFixedCents:0}}).where(eq(plansTable.id,planId));
    expect((await platformPaymentMetadata(tenantId,10000)).platform_card_fee).toBe("100");
  });
  it("does not retain a paid-plan fee discount after subscription cancellation",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await db.update(accounts).set({status:"canceled",stripeSubscriptionId:"sub_fixture"}).where(eq(accounts.tenantId,tenantId));
    await db.update(plansTable).set({publishedFeePolicy:{cardFeeBps:0,cardFeeFixedCents:0}}).where(eq(plansTable.id,planId));
    expect((await platformPaymentMetadata(tenantId,10000)).platform_card_fee).toBe("230");
    expect((await request(app).get("/software-billing")).body.account.hasSubscription).toBe(false);
  });
  it("does not allocate or transfer unconfirmed ACH payments",async()=>{
    state.intent.status="processing";state.intent.latest_charge.payment_method_details.type="us_bank_account";
    await recordPlatformPayment("pi_fixture");
    expect(await db.select().from(allocations).where(eq(allocations.tenantId,tenantId))).toHaveLength(0);
    expect(state.stripe.transfers.create).not.toHaveBeenCalled();
  });
  it("uses actual Stripe fees and the snapshotted card fee; duplicate delivery transfers once",async()=>{
    await recordPlatformPayment("pi_fixture");await recordPlatformPayment("pi_fixture");
    const payout=await processPlatformPayout("pi_fixture");await processPlatformPayout("pi_fixture");
    expect(payout.processorFeeCents).toBe(320);expect(payout.platformFeeCents).toBe(500);expect(payout.payoutCents).toBe(9180);
    expect(state.stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(state.stripe.transfers.create.mock.calls[0][0]).toMatchObject({source_transaction:"ch_fixture",destination:`acct_${tenantId}`,amount:9180});
  });
  it("uses the ACH fee rather than the card fee after bank confirmation",async()=>{
    state.intent.latest_charge.payment_method_details.type="us_bank_account";state.intent.latest_charge.balance_transaction.fee=80;
    await recordPlatformPayment("pi_fixture");const payout=await processPlatformPayout("pi_fixture");
    expect(payout.platformFeeCents).toBe(100);expect(payout.payoutCents).toBe(9820);
  });
  it("never guesses a missing Stripe fee or distributes money from a foreign snapshot",async()=>{
    state.intent.latest_charge.balance_transaction=null;await recordPlatformPayment("pi_fixture");
    expect((await processPlatformPayout("pi_fixture")).status).toBe("pending");expect(state.stripe.transfers.create).not.toHaveBeenCalled();
    state.intent.metadata.platform_destination="acct_foreign";
    await expect(recordPlatformPayment("pi_fixture")).rejects.toThrow("identity mismatch");
  });
  it("reverses a full returned payout once and never transfers it again",async()=>{
    await recordPlatformPayment("pi_fixture");await processPlatformPayout("pi_fixture");
    await recordPlatformReturn("pi_fixture",true,10000);await processPlatformPayout("pi_fixture");
    await recordPlatformReturn("pi_fixture",true,10000);await processPlatformPayout("pi_fixture");
    expect(state.stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect((await db.select().from(allocations).where(eq(allocations.paymentIntentId,"pi_fixture")))[0].status).toBe("reversed");
  });
  it("holds partial returns for review instead of reversing the whole business payout",async()=>{
    await recordPlatformPayment("pi_fixture");await processPlatformPayout("pi_fixture");await recordPlatformReturn("pi_fixture",true,1000);
    expect((await processPlatformPayout("pi_fixture")).status).toBe("review");expect(state.stripe.transfers.createReversal).not.toHaveBeenCalled();
  });
  it("does not retry uncertain transfers after the safe provider idempotency window",async()=>{
    await recordPlatformPayment("pi_fixture");
    await db.update(allocations).set({attemptedAt:new Date(Date.now()-24*3600000)}).where(eq(allocations.paymentIntentId,"pi_fixture"));
    expect((await processPlatformPayout("pi_fixture")).status).toBe("review");expect(state.stripe.transfers.create).not.toHaveBeenCalled();
  });
  it("does not start subscriptions while live billing is paused",async()=>{
    await expect(businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing")).rejects.toThrow("paused");
    expect(state.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("uses a real published recurring Price and reuses an open subscription checkout",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing");
    await businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing");
    expect(state.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const params=state.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.mode).toBe("subscription");expect(params.line_items).toEqual([{price:"price_fixture",quantity:1}]);
    expect(params.subscription_data.metadata.tenantId).toBe(String(tenantId));
  });
  it("blocks a second subscription while a completed checkout is awaiting provider confirmation",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing");
    state.stripe.checkout.sessions.retrieve.mockResolvedValue({id:"cs_fixture",status:"complete"});
    await expect(businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing")).rejects.toThrow("being confirmed");
    expect(state.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("confirms subscription status from Stripe and blocks a duplicate paid subscription",async()=>{
    await syncSoftwareSubscription("sub_fixture");
    const account=(await db.select().from(accounts).where(eq(accounts.tenantId,tenantId)))[0];
    expect(account.status).toBe("active");expect(account.stripeSubscriptionId).toBe("sub_fixture");
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await expect(businessSubscriptionCheckout(tenantId,planId,"https://example.invalid/software-billing")).rejects.toThrow("already exists");
  });
  it("ignores stale webhook status and unrelated business customer metadata",async()=>{
    const event={id:"evt_fixture",type:"customer.subscription.updated",data:{object:{id:"sub_fixture",customer:`cus_software_${tenantId}`,status:"past_due"}}} as unknown as Stripe.Event;
    await handlePlatformBillingEvent(event);
    expect((await db.select().from(accounts).where(eq(accounts.tenantId,tenantId)))[0].status).toBe("active");
    state.stripe.subscriptions.retrieve.mockResolvedValue({...await state.stripe.subscriptions.retrieve(),metadata:{purpose:"software_subscription",tenantId:"999999"}});
    await syncSoftwareSubscription("sub_fixture");
    expect((await db.select().from(accounts).where(eq(accounts.tenantId,tenantId)))[0].status).toBe("active");
  });
  it("publishes a new price revision without editing the price used by existing subscribers",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await db.update(plansTable).set({revision:2,price:149,cardFeeBps:300}).where(eq(plansTable.id,planId));
    await publishSoftwarePlan(planId,ownerId);
    expect(state.stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({unit_amount:14900,recurring:{interval:"month"}}),expect.anything());
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect((await db.select().from(softwarePlanPricesTable).where(eq(softwarePlanPricesTable.stripePriceId,"price_fixture")))[0].planId).toBe(planId);
  });
  it("keeps unpublished plan drafts out of the business catalog",async()=>{
    const [draft]=await db.insert(plansTable).values({name:"Draft only",tier:"draftonly",price:15}).returning();
    const response=await request(app).get("/plans");
    expect(response.status).toBe(200);expect(response.body.some((p:{id:number})=>p.id===draft.id)).toBe(false);
    expect(response.body.find((p:{id:number})=>p.id===planId).stripePriceId).toBeUndefined();
  });
  it("creates only one hosted Connect account and rejects missing payout consent",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));
    await db.update(accounts).set({connectAccountId:null,connectReady:false,termsAcceptedAt:null}).where(eq(accounts.tenantId,tenantId));
    expect((await request(app).post("/software-billing/connect").set("Origin","https://example.invalid").send({acceptedTerms:false})).status).toBe(400);
    for(let attempt=0;attempt<2;attempt++)expect((await request(app).post("/software-billing/connect").set("Origin","https://example.invalid").send({acceptedTerms:true})).status).toBe(200);
    expect(state.stripe.accounts.create).toHaveBeenCalledTimes(1);
    expect(state.stripe.accounts.create.mock.calls[0][0]).toMatchObject({type:"express",capabilities:{transfers:{requested:true}},metadata:{tenantId:String(tenantId)}});
  });
  it("uses the hosted portal for a confirmed plan change rather than silently updating a subscription",async()=>{
    await db.update(config).set({enabled:true}).where(eq(config.id,1));await syncSoftwareSubscription("sub_fixture");
    const response=await request(app).post("/software-billing/manage").set("Origin","https://example.invalid").send({planId});
    expect(response.status).toBe(200);expect(response.body.url.startsWith("https://billing.stripe.com/")).toBe(true);
    const params=state.stripe.billingPortal.sessions.create.mock.calls[0][0];
    expect(params.flow_data).toMatchObject({type:"subscription_update_confirm",subscription_update_confirm:{subscription:"sub_fixture",items:[{id:"si_fixture",price:"price_fixture",quantity:1}]}});
  });
  it("ignores forged business identity headers on billing reads",async()=>{
    state.userId=businessOwnerId;
    const response=await request(app).get("/software-billing").set("x-tenant-id","999999").set("x-user-id",String(ownerId));
    expect(response.status).toBe(200);expect(response.body.account.tenantId).toBe(tenantId);
  });
});
