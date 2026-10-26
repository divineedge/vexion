import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";

const state=vi.hoisted(()=>({connection:null as any,tenantId:0,userId:0,provider:{
  paymentIntents:{create:vi.fn(),retrieve:vi.fn()},
  customers:{create:vi.fn(),update:vi.fn()},
  paymentMethods:{retrieve:vi.fn(),attach:vi.fn(),detach:vi.fn()},
  setupIntents:{create:vi.fn(),retrieve:vi.fn()},
  checkout:{sessions:{create:vi.fn(),retrieve:vi.fn(),expire:vi.fn()}},
}}));
vi.mock("@workspace/db",async original=>{
  const module=await original<typeof import("@workspace/db")>();
  return {...module,db:new Proxy(module.db,{get(target,key){const current=state.connection??target,value=current[key];return typeof value==="function"?value.bind(current):value;}})};
});
vi.mock("./stripe",()=>({getStripeClient:()=>state.provider,getStripePublishableKey:()=>"pk_test_fixture",ensureStripeCustomer:async(_id:number,_name:string,_email:string,existing:string)=>existing}));
vi.mock("./stripeClient",()=>({getStripeClient:()=>state.provider}));
vi.mock("./tenantHelper",()=>({getTenantId:()=>state.tenantId,getUserId:()=>state.userId}));
import { db,pool,tenantsTable,customersTable,invoicesTable,estimatesTable,usersTable,taskNotificationsTable } from "@workspace/db";
import { chargeInvoiceCard } from "./invoiceCardPayments";
import { invoiceCheckout } from "./invoiceCheckout";
import { settleInvoiceCheckout } from "./invoiceSettlement";
import { companyDateKey,processDueInvoicePayments } from "./dueInvoicePayments";
import { validCardChoice,CARD_AUTHORIZATION_VERSION } from "./cardAuthorization";
import { recordInvoiceBankEvent, recordInvoiceBankReturn } from "./invoiceBankEvents";
import { invoicePaymentOptions } from "./invoicePaymentOptions";
import { PAYMENT_AUTHORIZATION_VERSION } from "./achPolicy";
import estimatesRouter from "../routes/estimates";
import paymentPolicyRouter from "../routes/paymentPolicy";

describe("Card authorization, collection and settlement (rollback-only DB; fake provider)",()=>{
  const connect=()=>pool.connect();let client:Awaited<ReturnType<typeof connect>>;
  let tenant:number,customer:number,owner:number,sequence=0,savepoint=0;
  const provider=state.provider;
  const app=express().use(express.json()).use(paymentPolicyRouter).use(estimatesRouter);
  beforeAll(async()=>{
    client=await pool.connect();await client.query("BEGIN");
    const raw=drizzle(client);
    state.connection=new Proxy(raw,{get(target,key){
      if(key==="transaction")return async(callback:(tx:any)=>Promise<unknown>)=>{
        const name=`card_test_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);
        try{const value=await callback(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return value;}
        catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error;}
      };
      const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;
    }});
    tenant=(await db.insert(tenantsTable).values({name:"Rollback card fixture",stripeEnabled:true,automaticInvoicePaymentMode:"when_sent",timezone:"America/Denver"}).returning())[0].id;
    owner=(await db.insert(usersTable).values({tenantId:tenant,name:"Rollback ACH owner",email:`ach-rollback-${tenant}@example.invalid`,role:"company_owner"}).returning())[0].id;
    state.tenantId=tenant;state.userId=owner;
    customer=(await db.insert(customersTable).values({tenantId:tenant,name:"Fixture payer",email:"payer@example.invalid",phone:"",stripeCustomerId:"cus_fixture",stripeDefaultPaymentMethodId:"pm_fixture",automaticPaymentAuthorizedAt:new Date("2026-01-01"),paymentAuthorizationMethodId:"pm_fixture"}).returning())[0].id;
  });
  afterAll(async()=>{if(client){try{await client.query("ROLLBACK");}finally{state.connection=null;client.release();await pool.end();}}});
  beforeEach(async()=>{
    state.tenantId=tenant;state.userId=owner;
    vi.clearAllMocks();
    provider.paymentIntents.create.mockImplementation(async(params:any)=>({id:`pi_${sequence}`,status:"succeeded",amount_received:params.amount,currency:"usd",customer:params.customer,payment_method:params.payment_method}));
    provider.customers.update.mockResolvedValue({});
    provider.paymentMethods.retrieve.mockResolvedValue({id:"pm_fixture",customer:"cus_fixture",card:{brand:"visa",last4:"4242",exp_year:2030,exp_month:12}});
    provider.paymentMethods.detach.mockResolvedValue({});
    provider.setupIntents.create.mockResolvedValue({id:"seti_fixture",client_secret:"seti_fixture_secret",status:"requires_confirmation"});
    provider.checkout.sessions.create.mockImplementation(async()=>({id:`cs_${sequence}`,url:"https://checkout.stripe.com/fixture"}));
    provider.checkout.sessions.retrieve.mockResolvedValue({id:"cs_open",status:"open"});
    provider.checkout.sessions.expire.mockResolvedValue({});
    await db.update(tenantsTable).set({paymentPolicy:null}).where(eq(tenantsTable.id,tenant));
    await db.update(customersTable).set({automaticPaymentAuthorizedAt:new Date("2026-01-01"),paymentAuthorizationMethodId:"pm_fixture"}).where(eq(customersTable.id,customer));
  });
  async function invoice(values:Partial<typeof invoicesTable.$inferInsert>={}){
    return (await db.insert(invoicesTable).values({tenantId:tenant,customerId:customer,invoiceNumber:`CARD-${++sequence}`,status:"sent",total:100,createdAt:new Date(),...values}).returning())[0];
  }
  async function ach(mode="optional",threshold=500){
    await db.update(tenantsTable).set({paymentPolicy:{ach:{mode,threshold},depositType:"full",requirePrepay:true}}).where(eq(tenantsTable.id,tenant));
  }
  function bank(){
    provider.paymentMethods.retrieve.mockResolvedValue({id:"pm_fixture",type:"us_bank_account",customer:"cus_fixture",us_bank_account:{bank_name:"Fixture Bank",last4:"6789"}});
  }
  it("validates and persists company ACH rules without overwriting deposits, and rejects unauthorized staff",async()=>{
    await ach("optional");
    const saved=await request(app).patch("/billing/ach-policy").send({mode:"require_above",threshold:750.25});
    expect(saved.status).toBe(200);
    expect((await request(app).get("/billing/ach-policy")).body).toEqual({mode:"require_above",threshold:750.25});
    expect((await request(app).patch("/billing/ach-policy").send({mode:"require_above",threshold:-1})).status).toBe(400);
    expect((await request(app).patch("/billing/ach-policy").send({mode:"optional",threshold:1,tenantId:tenant+999})).status).toBe(400);
    const [stored]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,tenant));
    expect(stored.paymentPolicy).toMatchObject({depositType:"full",requirePrepay:true,ach:{mode:"require_above",threshold:750.25}});
    state.userId=-1;
    expect((await request(app).get("/billing/ach-policy")).status).toBe(403);
    expect((await request(app).patch("/billing/ach-policy").send({mode:"disabled",threshold:0})).status).toBe(403);
  });
  it("offers secure ACH checkout and uses the net balance after credits/deposits for company rules",async()=>{
    await ach("require_above",100);
    const below=await invoice({total:150,creditApplied:25,depositApplied:25.01});
    await invoiceCheckout(tenant,customer,below.id,false,"https://example.invalid/invoice");
    expect(provider.checkout.sessions.create.mock.calls.at(-1)![0].payment_method_types).toEqual(["card"]);
    const exact=await invoice({total:150,creditApplied:25,depositApplied:25});
    await invoiceCheckout(tenant,customer,exact.id,true,"https://example.invalid/invoice");
    const payload=provider.checkout.sessions.create.mock.calls.at(-1)![0];
    expect(payload.payment_method_types).toEqual(["us_bank_account"]);
    expect(payload.payment_method_options.us_bank_account.verification_method).toBe("automatic");
    expect(payload.metadata.authorizationVersion).toBe(PAYMENT_AUTHORIZATION_VERSION);
    expect(payload.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(payload.line_items[0].price_data.unit_amount).toBe(10000);
    expect(JSON.stringify(payload)).not.toContain("routing_number");
    expect((await db.select().from(tenantsTable).where(eq(tenantsTable.id,tenant)))[0].paymentPolicy).toMatchObject({depositType:"full",requirePrepay:true});
  });
  it("does not let staff or automatic billing charge a saved card when ACH is required",async()=>{
    await ach("require_above",50);
    const inv=await invoice();
    expect((await chargeInvoiceCard(tenant,inv.id)).message).toContain("ACH is required");
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).toBe("unavailable");
    expect(provider.paymentIntents.create).not.toHaveBeenCalled();
  });
  it("keeps a saved-bank debit pending and blocks checkout and repeated automatic charging",async()=>{
    await ach();bank();
    const inv=await invoice();
    provider.paymentIntents.create.mockImplementation(async(params:any)=>({id:"pi_bank_pending",status:"processing",amount:params.amount,currency:"usd",customer:params.customer,payment_method:params.payment_method}));
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("pending");
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).toBe("pending");
    expect(provider.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [stored]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(stored.status).toBe("sent");expect(stored.paidAt).toBeNull();
    expect((await invoicePaymentOptions(stored)).paymentStatus).toBe("processing");
    await expect(invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice")).rejects.toThrow("previous payment");
  });
  it("treats unpaid completed checkout as processing, rejects cross-session events, then settles ACH exactly once",async()=>{
    await ach();bank();
    const inv=await invoice();
    await invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice");
    const sessionId=provider.checkout.sessions.create.mock.results.at(-1)!.value;
    const session=await sessionId;
    const meta={invoiceId:String(inv.id),tenantId:String(tenant),saveCard:"false"};
    const intent={id:"pi_async",status:"processing",amount:10000,amount_received:0,currency:"usd",customer:"cus_fixture",payment_method:"pm_fixture",metadata:meta};
    provider.paymentIntents.retrieve.mockResolvedValue(intent);
    await recordInvoiceBankEvent({id:"cs_wrong",metadata:meta,payment_intent:intent.id},"processing");
    const before=await db.execute(sql`SELECT status FROM invoice_card_attempts WHERE invoice_id=${inv.id}`);
    expect(before.rows[0].status).toBe("checkout_open");
    await recordInvoiceBankEvent({id:session.id,metadata:meta,payment_intent:intent.id},"processing");
    const [pending]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(pending.paidAt).toBeNull();expect((await invoicePaymentOptions(pending)).paymentStatus).toBe("processing");
    await settleInvoiceCheckout({id:session.id,payment_status:"unpaid",payment_intent:intent.id,customer:"cus_fixture",amount_total:10000,metadata:meta});
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id)))[0].status).toBe("sent");
    provider.paymentIntents.retrieve.mockResolvedValue({...intent,status:"succeeded",amount_received:10000});
    const completed={id:session.id,payment_status:"paid" as const,payment_intent:intent.id,customer:"cus_fixture",amount_total:10000,metadata:meta};
    await settleInvoiceCheckout(completed);await settleInvoiceCheckout(completed);
    const [paid]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(paid.status).toBe("paid");expect(paid.paymentMethod).toBe("ach");
    expect(provider.customers.update).not.toHaveBeenCalled();
    // A real return must win over a delayed or redelivered success event.
    await recordInvoiceBankReturn({id:"dp_fixture",payment_intent:intent.id,status:"needs_response",amount:10000} as any);
    await settleInvoiceCheckout(completed);
    const [returned]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(returned.status).toBe("sent");expect(returned.paidAt).toBeNull();
    expect((await invoicePaymentOptions(returned)).paymentStatus).toBe("review");
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).not.toBe("paid");
  });
  it("requires new bank authorization, never upgrades legacy card consent to bank consent",async()=>{
    await ach();bank();const inv=await invoice();
    provider.paymentIntents.retrieve.mockResolvedValue({id:"pi_bank_save",status:"succeeded",amount_received:10000,currency:"usd",customer:"cus_fixture",payment_method:"pm_fixture"});
    const session={id:"cs_bank_save",payment_status:"paid" as const,payment_intent:"pi_bank_save",customer:"cus_fixture",amount_total:10000,
      metadata:{invoiceId:String(inv.id),tenantId:String(tenant),saveCard:"true",authorizationVersion:CARD_AUTHORIZATION_VERSION}};
    await settleInvoiceCheckout(session);
    expect(provider.customers.update).not.toHaveBeenCalled();
    await settleInvoiceCheckout({...session,metadata:{...session.metadata,authorizationVersion:PAYMENT_AUTHORIZATION_VERSION}});
    expect(provider.customers.update).toHaveBeenCalledTimes(1);
    expect(provider.customers.update.mock.calls[0][1].metadata.automatic_payment_authorization).toBe(PAYMENT_AUTHORIZATION_VERSION);
    const [payer]=await db.select().from(customersTable).where(eq(customersTable.id,customer));
    expect(payer.cardExpiresAt).toBeNull();
    expect(payer.paymentAuthorizationMethodId).toBe("pm_fixture");
  });
  it("ignores stale bank failure notifications after success and preserves another company's invoice",async()=>{
    await ach();const inv=await invoice();
    await invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice");
    provider.paymentIntents.retrieve.mockResolvedValue({id:"pi_late",status:"succeeded",amount:10000,amount_received:10000,currency:"usd",customer:"cus_fixture"});
    await recordInvoiceBankEvent({metadata:{tenantId:String(tenant),invoiceId:String(inv.id)},payment_intent:"pi_late"},"failed");
    await recordInvoiceBankEvent({metadata:{tenantId:String(tenant+999),invoiceId:String(inv.id)},payment_intent:"pi_late"},"processing");
    expect((await db.execute(sql`SELECT status FROM invoice_card_attempts WHERE invoice_id=${inv.id}`)).rows[0].status).toBe("checkout_open");
  });
  it("records a definitive ACH failure once, leaves the balance unpaid, and allows a new customer checkout",async()=>{
    await ach();const inv=await invoice();
    await invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice");
    const session=await provider.checkout.sessions.create.mock.results.at(-1)!.value;
    const metadata={tenantId:String(tenant),invoiceId:String(inv.id)};
    provider.paymentIntents.retrieve.mockResolvedValue({id:"pi_failed_bank",status:"requires_payment_method",amount:10000,currency:"usd",customer:"cus_fixture"});
    const event={id:session.id,metadata,payment_intent:"pi_failed_bank"};
    await recordInvoiceBankEvent(event,"failed");await recordInvoiceBankEvent(event,"failed");
    const [stored]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(stored.status).toBe("sent");expect(stored.paidAt).toBeNull();
    expect((await invoicePaymentOptions(stored)).message).toContain("previous payment failed");
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM activity_log WHERE tenant_id=${tenant} AND entity_id=${inv.id} AND type='invoice_payment_attention'`)).rows[0].n).toBe(1);
    const alerts=await db.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.tenantId,tenant),eq(taskNotificationsTable.recipientUserId,owner)));
    expect(alerts.filter(alert=>alert.linkPath===`/invoices/${inv.id}`)).toHaveLength(1);
    await invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice");
    expect(provider.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });
  it("does not infer consent from an absent choice or preexisting stored card",async()=>{
    expect(validCardChoice(undefined)).toBe(false);
    expect(validCardChoice({saveCard:true,authorizationAccepted:false})).toBe(false);
    expect(validCardChoice({saveCard:false,authorizationAccepted:false})).toBe(true);
    const inv=await invoice();
    await db.update(customersTable).set({automaticPaymentAuthorizedAt:null}).where(eq(customersTable.id,customer));
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("unavailable");
    expect(provider.paymentIntents.create).not.toHaveBeenCalled();
    await db.update(customersTable).set({automaticPaymentAuthorizedAt:new Date()}).where(eq(customersTable.id,customer));
  });
  it("charges the remaining balance only, records success, and never charges a paid invoice twice",async()=>{
    const inv=await invoice({creditApplied:20,depositApplied:30});
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("paid");
    expect(provider.paymentIntents.create.mock.calls[0][0].amount).toBe(5000);
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("paid");
    expect(provider.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [saved]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));
    expect(saved.status).toBe("paid");expect(saved.paymentReference).toMatch(/^pi_/);
  });
  it("leaves declined invoices unpaid and never automatically retries a failed charge",async()=>{
    const inv=await invoice();
    provider.paymentIntents.create.mockRejectedValue(Object.assign(new Error("declined"),{type:"StripeCardError"}));
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).toBe("failed");
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).toBe("failed");
    expect(provider.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id)))[0].status).toBe("sent");
  });
  it("reuses the durable key after an uncertain provider timeout and blocks other checkout",async()=>{
    const inv=await invoice();
    provider.paymentIntents.create.mockRejectedValueOnce(new Error("network timeout"));
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("pending");
    await expect(invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice")).rejects.toThrow(/verification/);
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("paid");
    expect(provider.paymentIntents.create.mock.calls[0][1].idempotencyKey).toBe(provider.paymentIntents.create.mock.calls[1][1].idempotencyKey);
  });
  it("staff mode and wrong company do not perform automatic charges",async()=>{
    const inv=await invoice();
    await db.update(tenantsTable).set({automaticInvoicePaymentMode:"manual"}).where(eq(tenantsTable.id,tenant));
    expect((await chargeInvoiceCard(tenant,inv.id,"when_sent")).status).toBe("unavailable");
    expect((await chargeInvoiceCard(tenant+100000,inv.id)).status).toBe("unavailable");
    expect(provider.paymentIntents.create).not.toHaveBeenCalled();
    await db.update(tenantsTable).set({automaticInvoicePaymentMode:"when_sent"}).where(eq(tenantsTable.id,tenant));
  });
  it("honors opt-out in provider checkout and blocks staff charging during checkout",async()=>{
    const inv=await invoice();
    await invoiceCheckout(tenant,customer,inv.id,false,"https://example.invalid/invoice");
    expect(provider.checkout.sessions.create.mock.calls[0][0].payment_intent_data.setup_future_usage).toBeUndefined();
    expect(provider.checkout.sessions.create.mock.calls[0][0].metadata.saveCard).toBe("false");
    expect((await chargeInvoiceCard(tenant,inv.id)).status).toBe("pending");
    expect(provider.paymentIntents.create).not.toHaveBeenCalled();
  });
  it("records an explicit save authorization in provider checkout, never card numbers",async()=>{
    const inv=await invoice();
    await invoiceCheckout(tenant,customer,inv.id,true,"https://example.invalid/invoice");
    const params=provider.checkout.sessions.create.mock.calls[0][0];
    expect(params.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(params.metadata.authorizationVersion).toBe(CARD_AUTHORIZATION_VERSION);
    expect(JSON.stringify(params)).not.toMatch(/card_number|cvc/);
  });
  it("settles only a verified matching provider success and persists consent on the profile",async()=>{
    const inv=await invoice();
    provider.paymentIntents.retrieve.mockResolvedValue({id:"pi_checkout",status:"succeeded",currency:"usd",amount_received:10000,customer:"cus_fixture",payment_method:"pm_fixture"});
    const session={id:"cs_paid",payment_status:"paid" as const,payment_intent:"pi_checkout",customer:"cus_fixture",amount_total:10000,
      metadata:{invoiceId:String(inv.id),tenantId:String(tenant),saveCard:"true",authorizationVersion:CARD_AUTHORIZATION_VERSION}};
    await settleInvoiceCheckout(session);await settleInvoiceCheckout(session);
    const [saved]=await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id));expect(saved.status).toBe("paid");
    const [payer]=await db.select().from(customersTable).where(eq(customersTable.id,customer));
    expect(payer.paymentAuthorizationMethodId).toBe("pm_fixture");expect(payer.automaticPaymentAuthorizedAt).not.toBeNull();
    expect(provider.customers.update).toHaveBeenCalled();
    await db.update(customersTable).set({stripeDefaultPaymentMethodId:null,automaticPaymentAuthorizedAt:null,paymentAuthorizationMethodId:null}).where(eq(customersTable.id,customer));
    await settleInvoiceCheckout(session);
    expect((await db.select().from(customersTable).where(eq(customersTable.id,customer)))[0].stripeDefaultPaymentMethodId).toBeNull();
    await db.update(customersTable).set({stripeDefaultPaymentMethodId:"pm_fixture",automaticPaymentAuthorizedAt:payer.automaticPaymentAuthorizedAt,paymentAuthorizationMethodId:"pm_fixture"}).where(eq(customersTable.id,customer));
  });
  it("rejects foreign-provider ownership and never marks a mismatched payment paid",async()=>{
    const inv=await invoice();
    provider.paymentIntents.retrieve.mockResolvedValue({id:"pi_foreign",status:"succeeded",currency:"usd",amount_received:10000,customer:"cus_other"});
    await expect(settleInvoiceCheckout({id:"cs_foreign",payment_status:"paid",payment_intent:"pi_foreign",customer:"cus_fixture",amount_total:10000,metadata:{invoiceId:String(inv.id),tenantId:String(tenant)}})).rejects.toThrow(/ownership/);
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,inv.id)))[0].status).toBe("sent");
  });
  it("charges due-date invoices using company today, not UTC's next day",async()=>{
    await db.update(tenantsTable).set({automaticInvoicePaymentMode:"due_date"}).where(eq(tenantsTable.id,tenant));
    const due=await invoice({dueDate:new Date("2026-10-22T00:00:00Z")});
    const tomorrow=await invoice({dueDate:new Date("2026-10-23T00:00:00Z")});
    expect(companyDateKey(new Date("2026-10-23T01:00:00Z"),"America/Denver")).toBe("2026-10-22");
    await processDueInvoicePayments(new Date("2026-10-23T01:00:00Z"));
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,due.id)))[0].status).toBe("paid");
    expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id,tomorrow.id)))[0].status).toBe("sent");
  });
  it("direct estimate links collect only the required deposit, honor opt-out, and accept without login",async()=>{
    const token=`card-estimate-${tenant}-${++sequence}`;
    const [estimate]=await db.insert(estimatesTable).values({tenantId:tenant,customerId:customer,status:"sent",approvalToken:token,paymentRequirement:"deposit_fixed",depositValue:25,
      lineItems:[{id:"base",description:"Authorized service",qty:1,unitPrice:100,markup:0,discount:0,isOptional:false}]}).returning();
    const setup=await request(app).post(`/public/estimates/${token}/setup-intent`).send({saveCard:false,authorizationAccepted:false});
    expect(setup.status).toBe(200);expect(provider.setupIntents.create.mock.calls[0][0].usage).toBe("on_session");
    const pay=await request(app).post(`/public/estimates/${token}/pay-deposit`).send({saveCard:false,authorizationAccepted:false,paymentMethodId:"pm_one_time",acceptedOptionalItemIds:[]});
    expect(pay.status).toBe(200);expect(pay.body.chargedAmount).toBe(25);
    expect(provider.paymentIntents.create.mock.calls[0][0].amount).toBe(2500);
    expect(provider.paymentMethods.detach).toHaveBeenCalledWith("pm_one_time");
    const accept=await request(app).post(`/public/estimates/${token}/respond`).send({action:"approve",saveCard:false,authorizationAccepted:false,acceptedOptionalItemIds:[]});
    expect(accept.status).toBe(200);
    expect((await db.select().from(estimatesTable).where(eq(estimatesTable.id,estimate.id)))[0].status).toBe("approved");
  });
  it("does not accept an estimate as paid or save its card from an unconfirmed setup",async()=>{
    const token=`unconfirmed-estimate-${tenant}-${++sequence}`;
    await db.insert(estimatesTable).values({tenantId:tenant,customerId:customer,status:"sent",approvalToken:token,
      lineItems:[{id:"base",description:"Authorized service",qty:1,unitPrice:100,markup:0,discount:0,isOptional:false}]});
    provider.setupIntents.retrieve.mockResolvedValue({id:"seti_bad",status:"requires_confirmation",customer:"cus_fixture",payment_method:"pm_fixture",metadata:{estimateId:"bad",saveCard:"true",authorizationVersion:CARD_AUTHORIZATION_VERSION}});
    const response=await request(app).post(`/public/estimates/${token}/respond`).send({action:"approve",paymentMethodId:"pm_fixture",setupIntentId:"seti_bad",saveCard:true,authorizationAccepted:true});
    expect(response.status).toBe(422);expect(provider.customers.update).not.toHaveBeenCalled();
  });
});
