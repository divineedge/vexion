import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomBytes,randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
const state=vi.hoisted(()=>({connection:null as any,userId:0,tenantId:0,send:vi.fn()}));
vi.mock("@workspace/db",async original=>{const m=await original<typeof import("@workspace/db")>();return {...m,db:new Proxy(m.db,{get(target,key){const active=state.connection??target;const value=active[key];return typeof value==="function"?value.bind(active):value;}})};});
vi.mock("./emailProvider",()=>({sendEmail:state.send}));
import { db,pool,tenantsTable,usersTable,platformOwnersTable,staffSessionsTable,accountSecurityTable,supportThreadsTable,supportMessagesTable,supportUploadsTable,companyExperienceTable,plansTable,softwareBillingAccountsTable,propertiesTable,customersTable,operationsAlertsTable,taskNotificationsTable,reviewRequestsTable,reviewPhotosTable } from "@workspace/db";
import { and,eq,sql } from "drizzle-orm";
import experienceRouter from "../routes/experience";
import securityRouter,{publicAccountSecurityRouter} from "../routes/accountSecurity";
import authRouter from "../routes/auth";
import reviewsRouter from "../routes/reviews";
import reviewPhotosRouter,{publicReviewPhotosRouter} from "../routes/reviewPhotos";
import { base32,totp,matchedStep,sealSecret,tokenDigest,recoveryDigest,verifySecondFactor,authFailure } from "./accountSecurity";
import { assertSoftwareCapacity,recordOperationsAlert } from "./experienceCore";
import { imageType,privateImageName,imageMultipart } from "./supportImages";

describe("launch experience privacy, recovery, support and capacity",()=>{
  let client:any,sp=0,tenantA=0,tenantB=0,userA=0,ownerA=0,admin=0,passwordHash="";
  const rawTokens=new Map<number,string>(),password="FixturePassword1!";
  const secret=base32(Buffer.from("12345678901234567890"));
  const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{verifiedTenantId:state.tenantId,verifiedUserId:state.userId});next();});app.use(authRouter);app.use(publicAccountSecurityRouter);app.use(experienceRouter);app.use(securityRouter);app.use(publicReviewPhotosRouter);app.use(reviewPhotosRouter);app.use(reviewsRouter);
  const authed=(r:any)=>r.set("Authorization",`Bearer ${rawTokens.get(state.userId)}`);
  const act=(action:string,payload:object)=>authed(request(app).post("/experience/actions")).send({action,payload});
  const asUser=(id:number,tenant:number)=>{state.userId=id;state.tenantId=tenant;};
  beforeAll(async()=>{
    vi.stubEnv("SESSION_SECRET","fixture-only-encryption-key-not-a-live-secret");
    client=await pool.connect();await client.query("BEGIN");
    const connection=drizzle(client);
    state.connection=new Proxy(connection,{get(target,key){if(key==="transaction")return async(fn:any)=>{const name=`nested_exp_${++sp}`;await client.query(`SAVEPOINT ${name}`);try{const result=await fn(state.connection);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);throw error;}};const value=(target as any)[key];return typeof value==="function"?value.bind(target):value;}});
    const [a]=await db.insert(tenantsTable).values({name:"Rollback experience A",emailProvider:"resend"}).returning();tenantA=a.id;
    const [b]=await db.insert(tenantsTable).values({name:"Rollback experience B"}).returning();tenantB=b.id;
    passwordHash=await bcrypt.hash(password,4);
    for(const [name,role,tenant] of [["staff","technician",tenantA],["owner","company_owner",tenantA],["software","company_owner",tenantB]] as const){
      const [u]=await db.insert(usersTable).values({tenantId:tenant,name,email:`${name}-${tenant}@example.invalid`,passwordHash,role}).returning();
      if(name==="staff")userA=u.id;else if(name==="owner")ownerA=u.id;else admin=u.id;
      const token=randomBytes(32).toString("hex");rawTokens.set(u.id,token);await db.insert(staffSessionsTable).values({tenantId:tenant,userId:u.id,tokenHash:tokenDigest(token),expiresAt:new Date(Date.now()+86400000)});
    }
    await db.insert(platformOwnersTable).values({userId:admin});
  });
  beforeEach(async()=>{await client.query("SAVEPOINT test_case");asUser(userA,tenantA);state.send.mockReset().mockResolvedValue({success:true,externalId:"fake-only"});});
  afterEach(async()=>{await client.query("ROLLBACK TO SAVEPOINT test_case");await client.query("RELEASE SAVEPOINT test_case");});
  afterAll(async()=>{await client.query("ROLLBACK");state.connection=null;client.release();await pool.end();vi.unstubAllEnvs();});
  it("matches an RFC6238 SHA1 vector and rejects replay",()=>{expect(totp(secret,1)).toBe("287082");expect(matchedStep(secret,"287082",null,59000)).toBe(1);expect(matchedStep(secret,"287082",1,59000)).toBeNull();});
  it("keeps requests private and does not store unconsented diagnostics",async()=>{
    const created=await act("createThread",{kind:"feature",title:"Fixture idea",body:"Please add a report",page:"/jobs",clientVersion:"web"});expect(created.status).toBe(200);
    const thread=created.body.result;expect(thread.diagnostics).toEqual({});
    asUser(ownerA,tenantA);const other=await authed(request(app).get("/experience"));expect(other.body.threads).toEqual([]);
    expect((await act("replyThread",{threadId:thread.id,body:"Not mine"})).status).toBe(404);
    asUser(admin,tenantB);expect((await authed(request(app).get("/experience/admin"))).body.threads.some((t:any)=>t.id===thread.id)).toBe(true);
  });
  it("records only consented path/version diagnostics and rejects secret-bearing URLs",async()=>{
    expect((await act("createThread",{kind:"problem",title:"Fixture",body:"Details",diagnosticsConsent:true,page:"/jobs?token=do-not-store"})).status).toBe(400);
    const good=await act("createThread",{kind:"problem",title:"Fixture",body:"Details",diagnosticsConsent:true,page:"/jobs",clientVersion:"web-1"});expect(good.body.result.diagnostics).toMatchObject({page:"/jobs",clientVersion:"web-1",consent:true});
  });
  it("protects software administration and company actions from ordinary staff",async()=>{
    expect((await authed(request(app).get("/experience/admin"))).status).toBe(403);
    expect((await act("saveContent",{kind:"help",title:"Fake",body:"Fake",published:true})).status).toBe(403);
    expect((await act("saveCompanyPolicy",{tenantId:tenantB,subscriptionRequired:true,trialUntil:null,graceDays:0,enforceLimits:true})).status).toBe(403);
    expect((await act("saveOnboarding",{completedSteps:[]})).status).toBe(403);
    expect((await authed(request(app).get("/experience/export"))).status).toBe(403);
  });
  it("keeps internal notes and attachments out of a customer's support view",async()=>{
    const created=await act("createThread",{kind:"help",title:"Private",body:"Help"}),threadId=created.body.result.id;
    asUser(admin,tenantB);const imageId=randomUUID();await db.insert(supportUploadsTable).values({id:imageId,userId:admin,tenantId:tenantB,objectPath:"/private/fixture",name:"private.png",contentType:"image/png",size:10});
    expect((await act("replyThread",{threadId,body:"Internal investigation",internal:true,attachments:[imageId]})).status).toBe(200);
    asUser(userA,tenantA);const own=await authed(request(app).get("/experience"));
    expect(own.body.messages.some((m:any)=>m.body==="Internal investigation")).toBe(false);
    expect((await authed(request(app).get(`/experience/uploads/${imageId}`))).status).toBe(404);
  });
  it("updates linked request statuses without exposing the other company's content",async()=>{
    const first=(await act("createThread",{kind:"feature",title:"Company A private",body:"Private A"})).body.result;
    asUser(admin,tenantB);const second=(await act("createThread",{kind:"feature",title:"Company B private",body:"Private B"})).body.result;
    expect((await act("updateThread",{threadId:first.id,status:"planned",priority:"high",duplicateOf:second.id})).status).toBe(200);
    expect((await act("updateThread",{threadId:second.id,status:"released",priority:"normal"})).status).toBe(200);
    asUser(userA,tenantA);const own=await authed(request(app).get("/experience"));expect(own.body.threads[0].status).toBe("released");expect(JSON.stringify(own.body)).not.toContain("Company B private");
  });
  it("never lets an ordinary staff member attach somebody else's image",async()=>{
    const imageId=randomUUID();await db.insert(supportUploadsTable).values({id:imageId,userId:admin,tenantId:tenantB,objectPath:"/private/fixture",name:"private.png",contentType:"image/png",size:10});
    expect((await act("createThread",{kind:"problem",title:"Bad attachment",body:"No",attachments:[imageId]})).status).toBe(403);
  });
  it("publishes content and persists onboarding without rewriting policies",async()=>{
    asUser(admin,tenantB);const draft=await act("saveContent",{kind:"help",title:"Fixture draft",body:"Not public",published:false});expect(draft.status).toBe(200);
    asUser(ownerA,tenantA);expect((await act("saveOnboarding",{completedSteps:["company","customers"]})).status).toBe(200);
    let own=await authed(request(app).get("/experience"));expect(own.body.onboarding.completedSteps).toEqual(["company","customers"]);expect(own.body.content.some((c:any)=>c.title==="Fixture draft")).toBe(false);
    asUser(admin,tenantB);await act("saveContent",{id:draft.body.result.id,kind:"help",title:"Fixture draft",body:"Now public",published:true});
    asUser(userA,tenantA);own=await authed(request(app).get("/experience"));expect(own.body.content.some((c:any)=>c.body==="Now public")).toBe(true);
  });
  it("deduplicates operations notifications while keeping company alerts private",async()=>{
    await recordOperationsAlert("fixture-alert",tenantA,"fixture","high","Action needed");
    await recordOperationsAlert("fixture-alert",tenantA,"fixture","high","Action still needed");
    const notifications=await db.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.recipientUserId,ownerA),eq(taskNotificationsTable.type,"software_support")));expect(notifications).toHaveLength(1);
    asUser(admin,tenantB);const own=await authed(request(app).get("/experience"));expect(own.body.alerts.some((x:any)=>x.id==="fixture-alert")).toBe(false);
  });
  it("enforces opt-in seat/property limits but leaves historical reads and legacy businesses alone",async()=>{
    const [plan]=await db.insert(plansTable).values({name:"Fixture capacity",tier:`fixture-${tenantA}`,price:10,maxUsers:2,maxProperties:1}).returning();
    await db.insert(softwareBillingAccountsTable).values({tenantId:tenantA,planId:plan.id,status:"active",stripeSubscriptionId:`sub_fixture_${tenantA}`});
    await db.insert(companyExperienceTable).values({tenantId:tenantA,enforceLimits:true});
    await expect(assertSoftwareCapacity(state.connection,tenantA,"users")).rejects.toThrow("allows 2");
    const [customer]=await db.insert(customersTable).values({tenantId:tenantA,name:"Fixture customer",email:"",phone:""}).returning();
    await db.insert(propertiesTable).values({tenantId:tenantA,customerId:customer.id,address:"Fixture property"});
    await expect(assertSoftwareCapacity(state.connection,tenantA,"properties")).rejects.toThrow("allows 1");
    await expect(assertSoftwareCapacity(state.connection,tenantB,"users")).resolves.toBeUndefined();
    expect((await authed(request(app).get("/experience"))).status).toBe(200);
  });
  it("honors explicit trial/grace periods without charging or deleting data",async()=>{
    await db.insert(companyExperienceTable).values({tenantId:tenantA,subscriptionRequired:true,requiredSince:new Date(Date.now()-10*86400000),graceDays:7});
    await expect(assertSoftwareCapacity(state.connection,tenantA,"users")).rejects.toThrow("subscription is required");
    await db.update(companyExperienceTable).set({trialUntil:new Date(Date.now()+86400000)}).where(eq(companyExperienceTable.tenantId,tenantA));
    await expect(assertSoftwareCapacity(state.connection,tenantA,"users")).resolves.toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });
  it("requires MFA before issuing a password-login session and consumes recovery codes once",async()=>{
    await db.insert(accountSecurityTable).values({userId:userA,enabled:true,encryptedSecret:sealSecret(secret),recoveryHashes:[recoveryDigest("SYNTHETIC-RECOVERY-CODE")]});
    const email=`staff-${tenantA}@example.invalid`;
    expect((await request(app).post("/auth/login").send({email,password})).body.mfaRequired).toBe(true);
    const login=await request(app).post("/auth/login").send({email,password,twoFactorCode:"SYNTHETIC-RECOVERY-CODE"});expect(login.status).toBe(200);
    expect(await verifySecondFactor(userA,"SYNTHETIC-RECOVERY-CODE")).toBe("invalid");
  });
  it("keeps enrollment pending until confirmed and never returns stored secrets on status reads",async()=>{
    const enrolled=await authed(request(app).post("/account-security")).send({action:"enroll",password});expect(enrolled.status).toBe(200);
    const pending=await authed(request(app).get("/account-security"));expect(pending.body).toEqual({enabled:false,recoveryCodesRemaining:0});
    const confirmed=await authed(request(app).post("/account-security")).send({action:"confirm",password,code:totp(enrolled.body.secret)});expect(confirmed.status).toBe(200);expect(confirmed.body.recoveryCodes).toHaveLength(8);
    const stored=(await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userA)))[0];expect(stored.encryptedSecret).not.toContain(enrolled.body.secret);expect(JSON.stringify(stored.recoveryHashes)).not.toContain(confirmed.body.recoveryCodes[0]);
  });
  it("returns a non-enumerating reset response and enforces one-use tokens while retaining MFA",async()=>{
    const email=`staff-${tenantA}@example.invalid`;
    await db.insert(accountSecurityTable).values({userId:userA,enabled:true,encryptedSecret:sealSecret(secret)});
    const known=await request(app).post("/auth/password-reset/request").send({email}),unknown=await request(app).post("/auth/password-reset/request").send({email:"unknown@example.invalid"});expect(known.body).toEqual(unknown.body);
    const body=String(state.send.mock.calls[0][3]),token=body.match(/\n\n([A-Za-z0-9_-]{32})\n/)?.[1];expect(token).toBeTruthy();
    const input={token,password:"NewFixturePassword1!"};expect((await request(app).post("/auth/password-reset/confirm").send(input)).status).toBe(200);expect((await request(app).post("/auth/password-reset/confirm").send(input)).status).toBe(400);
    const [security]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userA));expect(security.enabled).toBe(true);expect(security.resetHash).toBeNull();
    expect(await db.select().from(staffSessionsTable).where(eq(staffSessionsTable.userId,userA))).toHaveLength(0);
  });
  it("does not fake recovery email delivery without a provider",async()=>{
    const unknown=await request(app).post("/auth/password-reset/request").send({email:"nobody@example.invalid"});
    const noProvider=await request(app).post("/auth/password-reset/request").send({email:`software-${tenantB}@example.invalid`});expect(unknown.body).toEqual(noProvider.body);expect(state.send).not.toHaveBeenCalled();
    const [alert]=await db.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.id,`recovery-email-${tenantB}`));expect(alert.source).toBe("account_recovery");
  });
  it("rejects executable image formats even with image file names",()=>{expect(imageType(Buffer.from("<svg onload='alert(1)'>"))).toBeNull();expect(imageType(Buffer.from("<html>"))).toBeNull();expect(imageType(Buffer.from([137,80,78,71,13,10,26,10]))).toBe("image/png");});
  it("always uses a safe extension matching detected image bytes",()=>{
    expect(privateImageName("invoice.html","image/png")).toBe("invoice.png");
    expect(privateImageName("../unsafe\r\n<script>.exe","image/jpeg")).not.toMatch(/[\/\r\n<>]/);
    expect(privateImageName("photo.js","image/webp")).toBe("photo.webp");
  });
  it("resets an expired password-attempt lock instead of immediately locking again",async()=>{
    await db.insert(accountSecurityTable).values({userId:userA,failures:5,blockedUntil:new Date(Date.now()-86400000)});
    await authFailure(userA);const[row]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userA));expect(row.failures).toBe(1);expect(row.blockedUntil).toBeNull();
  });
  it("keeps valid recovery codes usable if the authenticator encryption key changes",async()=>{
    await db.insert(accountSecurityTable).values({userId:userA,enabled:true,encryptedSecret:"old-key-unreadable",recoveryHashes:[recoveryDigest("VALID-ONE-TIME-RECOVERY")]});
    expect(await verifySecondFactor(userA,"VALID-ONE-TIME-RECOVERY")).toBe("ok");expect(await verifySecondFactor(userA,"VALID-ONE-TIME-RECOVERY")).toBe("invalid");
  });
  it("publishes release notifications once, without committing any real-staff notifications",async()=>{
    asUser(admin,tenantB);
    const countForUser=async()=>(await db.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.recipientUserId,userA),eq(taskNotificationsTable.type,"software_support")))).length;
    const before=await countForUser();
    const created=await act("saveContent",{kind:"release",title:"Rollback release",body:"Fixture only",published:true});expect(created.status).toBe(200);expect(await countForUser()).toBe(before+1);
    await act("saveContent",{id:created.body.result.id,kind:"release",title:"Rollback release edited",body:"Fixture only",published:true});expect(await countForUser()).toBe(before+1);
  });
  it("opens public feedback even when the company's first nullable setting is unset",async()=>{
    const[c]=await db.insert(customersTable).values({tenantId:tenantA,name:"Review fixture",email:"",phone:""}).returning(),token=randomUUID();
    const[review]=await db.insert(reviewRequestsTable).values({tenantId:tenantA,customerId:c.id,channel:"email",token}).returning();
    expect((await request(app).get(`/public/reviews/${token}`)).body).toMatchObject({tenantId:tenantA,status:"pending"});
    expect((await request(app).post(`/public/reviews/${token}/rating`).send({rating:2})).status).toBe(200);
    expect((await request(app).post(`/public/reviews/${token}/feedback`).send({checklistSelections:["Quality"],feedbackText:"Fixture feedback"})).status).toBe(200);
    const[alert]=await db.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.id,`review-low-${review.id}`));expect(alert.tenantId).toBe(tenantA);expect(alert.resolved).toBe(false);
    expect((await authed(request(app).get("/reviews"))).status).toBe(403);
    asUser(ownerA,tenantA);expect((await authed(request(app).get("/reviews"))).body.some((r:any)=>r.id===review.id)).toBe(true);
    expect((await authed(request(app).patch(`/reviews/${review.id}`)).send({reviewStatus:"reviewed"})).status).toBe(200);
    expect((await db.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.id,`review-low-${review.id}`)))[0].resolved).toBe(true);
  });
  it("keeps customer feedback photo links bound to the exact invitation and company",async()=>{
    const[c]=await db.insert(customersTable).values({tenantId:tenantA,name:"Review image fixture",email:"",phone:""}).returning(),token=randomUUID(),id=randomUUID();
    const[review]=await db.insert(reviewRequestsTable).values({tenantId:tenantA,customerId:c.id,channel:"email",token}).returning();
    await db.insert(reviewPhotosTable).values({id,reviewId:review.id,tenantId:tenantA,objectPath:"/private/fixture",name:"fixture.png",contentType:"image/png"});
    expect((await request(app).get(`/public/reviews/not-the-invitation/photos/${id}`)).status).toBe(404);
    expect((await request(app).post("/public/reviews/invalid/photos").attach("file",Buffer.alloc(100),"fake.png")).status).toBe(410);
    asUser(admin,tenantB);expect((await authed(request(app).get(`/reviews/${review.id}/photos/${id}`))).status).toBe(404);
    expect((await request(app).post(`/public/reviews/${token}/rating`).send({rating:2.5})).status).toBe(400);
    expect((await request(app).post(`/public/reviews/${token}/feedback`).send({feedbackText:"x".repeat(8001)})).status).toBe(400);
  });
  it("lets office managers finish onboarding without granting software-owner access",async()=>{
    await db.update(usersTable).set({role:"office_manager"}).where(eq(usersTable.id,userA));
    expect((await act("saveOnboarding",{completedSteps:["company"]})).status).toBe(200);
    expect((await authed(request(app).get("/experience"))).body.isManager).toBe(true);
    expect((await authed(request(app).get("/experience/admin"))).status).toBe(403);
  });
  it("persists trial/grace policies using an ISO timestamp and restores opt-in defaults",async()=>{
    asUser(admin,tenantB);
    const baseline={tenantId:tenantA,subscriptionRequired:false,enforceLimits:false,trialUntil:null,graceDays:7};
    expect((await act("saveCompanyPolicy",{...baseline,subscriptionRequired:true,enforceLimits:true,trialUntil:"2026-12-31T23:59:59.999Z",graceDays:14})).status).toBe(200);
    const response=await authed(request(app).get("/experience/admin"));
    expect(response.body.businesses.find((b:any)=>b.id===tenantA).policy).toMatchObject({subscriptionRequired:true,enforceLimits:true,trialUntil:"2026-12-31T23:59:59.999Z",graceDays:14});
    expect((await act("saveCompanyPolicy",baseline)).status).toBe(200);
  });
  it("does not release upload capacity early when a client disconnects during processing",()=>{
    const responses:any[]=[];let ready=0;
    const response=()=>{const r:any=new EventEmitter();r.locals={};r.status=(code:number)=>{r.statusCode=code;return r;};r.json=()=>r;return r;};
    try{
      for(let i=0;i<8;i++){const r=response();responses.push(r);imageMultipart({headers:{}} as any,r,()=>{ready++;});}
      expect(ready).toBe(8);responses[0].emit("close");
      const blocked=response();imageMultipart({headers:{}} as any,blocked,()=>{ready++;});expect(blocked.statusCode).toBe(429);expect(ready).toBe(8);
    }finally{for(const r of responses)r.locals.releaseImageUpload?.();}
  });
});
