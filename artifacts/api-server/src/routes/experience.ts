import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and,eq,inArray,desc,sql,count,isNull } from "drizzle-orm";
import { db,supportThreadsTable as threads,supportMessagesTable as messages,supportUploadsTable,productContentTable as content,companyExperienceTable as companies,recoveryDrillsTable,operationsAlertsTable,usersTable,tenantsTable,platformOwnersTable,softwareBillingAccountsTable,plansTable,customersTable,propertiesTable } from "@workspace/db";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { isSoftwareOwner } from "../lib/softwareBilling";
import { notifyExperience,runOperationsChecks,type ExperienceTx } from "../lib/experienceCore";
import { platformBillingAuditTable } from "@workspace/db";
import { privateImageUpload,downloadPrivateImage } from "../lib/supportImages";
import { ADMIN_ROLES } from "../lib/roles";

const router=Router();
const text=z.string().trim().min(1);
const id=z.string().uuid();
const attachments=z.array(id).max(3).default([]);
const status=z.enum(["received","planned","in_progress","released","resolved"]);
const priority=z.enum(["low","normal","high"]);
const actions=z.discriminatedUnion("action",[
  z.object({action:z.literal("createThread"),payload:z.object({kind:z.enum(["problem","feature","help"]),title:text.max(160),body:text.max(10000),attachments,diagnosticsConsent:z.boolean().optional(),page:z.string().max(180).regex(/^\/[a-zA-Z0-9/_-]*$/).optional(),clientVersion:z.string().max(64).regex(/^[a-zA-Z0-9._-]*$/).optional()}).strict()}),
  z.object({action:z.literal("replyThread"),payload:z.object({threadId:id,body:text.max(10000),attachments,internal:z.boolean().default(false)}).strict()}),
  z.object({action:z.literal("updateThread"),payload:z.object({threadId:id,status,priority,assigneeId:z.number().int().positive().nullable().optional(),duplicateOf:id.nullable().optional()}).strict()}),
  z.object({action:z.literal("saveContent"),payload:z.object({id:id.optional(),kind:z.enum(["help","release"]),title:text.max(160),body:text.max(30000),published:z.boolean()}).strict()}),
  z.object({action:z.literal("saveOnboarding"),payload:z.object({completedSteps:z.array(z.enum(["company","services","employees","payments","customers","test_estimate","test_invoice","test_payment","data_recovery","email"])).max(10)}).strict()}),
  z.object({action:z.literal("saveCompanyPolicy"),payload:z.object({tenantId:z.number().int().positive(),subscriptionRequired:z.boolean(),trialUntil:z.string().datetime().nullable(),graceDays:z.number().int().min(0).max(60),enforceLimits:z.boolean()}).strict()}),
  z.object({action:z.literal("recordRecoveryDrill"),payload:z.object({environment:z.enum(["development","staging"]),evidence:text.max(5000),passed:z.boolean()}).strict()}),
  z.object({action:z.literal("runChecks"),payload:z.object({}).strict()}),
  z.object({action:z.literal("resolveAlert"),payload:z.object({id:text.max(200)}).strict()}),
]);
async function actor(req:Parameters<typeof getUserId>[0]){
  const userId=getUserId(req),tenantId=getTenantId(req);
  const [user]=await db.select().from(usersTable).where(and(eq(usersTable.id,userId),eq(usersTable.tenantId,tenantId),eq(usersTable.isActive,true)));
  if(!user)throw Object.assign(new Error("Active staff account required"),{status:401});
  return {user,userId,tenantId,admin:await isSoftwareOwner(userId,tenantId),manager:ADMIN_ROLES.has(user.role)};
}
async function validateUploads(tx:ExperienceTx,ids:string[],userId:number,tenantId:number){
  if(!ids.length)return;
  const rows=await tx.select({id:supportUploadsTable.id}).from(supportUploadsTable).where(and(inArray(supportUploadsTable.id,ids),eq(supportUploadsTable.userId,userId),eq(supportUploadsTable.tenantId,tenantId)));
  if(new Set(rows.map(r=>r.id)).size!==new Set(ids).size)throw Object.assign(new Error("An attachment does not belong to your account"),{status:403});
}
async function ownerRecipients(tx:ExperienceTx){return tx.select({id:usersTable.id,tenantId:usersTable.tenantId}).from(usersTable).innerJoin(platformOwnersTable,eq(usersTable.id,platformOwnersTable.userId)).where(eq(usersTable.isActive,true));}
async function auditAction(tx:ExperienceTx,userId:number,action:string,details:object){await tx.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId:userId,action:`experience_${action}`,details});}
router.get("/experience",async(req,res)=>{
  const a=await actor(req);
  const own=await db.select().from(threads).where(and(eq(threads.userId,a.userId),eq(threads.tenantId,a.tenantId))).orderBy(desc(threads.updatedAt));
  const replies=own.length?await db.select().from(messages).where(and(inArray(messages.threadId,own.map(t=>t.id)),eq(messages.internal,false))).orderBy(messages.createdAt):[];
  const published=await db.select().from(content).where(eq(content.published,true)).orderBy(desc(content.updatedAt));
  const [company]=await db.select().from(companies).where(eq(companies.tenantId,a.tenantId));
  const [tenant]=await db.select({name:tenantsTable.name,timezone:tenantsTable.timezone,emailProvider:tenantsTable.emailProvider}).from(tenantsTable).where(eq(tenantsTable.id,a.tenantId));
  const [customerCount]=await db.select({n:count()}).from(customersTable).where(eq(customersTable.tenantId,a.tenantId));
  const [staffCount]=await db.select({n:count()}).from(usersTable).where(and(eq(usersTable.tenantId,a.tenantId),eq(usersTable.isActive,true)));
  const [account]=await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,a.tenantId));
  const checks=[
    {key:"company",label:"Company name and timezone configured",complete:!!tenant?.name&&!!tenant.timezone,href:"/settings"},
    {key:"employees",label:"A team member has been added",complete:Number(staffCount.n)>1,href:"/employees"},
    {key:"customers",label:"Your first customer has been added",complete:Number(customerCount.n)>0,href:"/customers"},
    {key:"email",label:"Email provider configured",complete:!!tenant?.emailProvider,href:"/settings"},
    {key:"payments",label:"Stripe business payout setup confirmed",complete:!!account?.connectReady,href:"/software-billing"},
    {key:"services",label:"Review services and pricing",complete:false,href:"/services"},
    {key:"test_estimate",label:"Create and review a test estimate",complete:false,href:"/estimates"},
    {key:"test_invoice",label:"Create and review a test invoice",complete:false,href:"/invoices"},
    {key:"test_payment",label:"Verify a test-mode payment",complete:false,href:"/software-billing"},
    {key:"data_recovery",label:"Review exports and the recovery procedure",complete:false,href:"/getting-started"},
  ];
  const alerts=a.manager?await db.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.tenantId,a.tenantId)).orderBy(desc(operationsAlertsTable.updatedAt)):[];
  res.set("Cache-Control","no-store").json({threads:own,messages:replies,content:published,onboarding:{completedSteps:company?.completedSteps??[],checks},alerts,isManager:a.manager,isSoftwareOwner:a.admin});
});
router.get("/experience/admin",async(req,res)=>{
  const a=await actor(req);if(!a.admin){res.status(403).json({error:"Software-owner access required"});return;}
  const rows=await db.select({tenant:{id:tenantsTable.id,name:tenantsTable.name},policy:companies,account:softwareBillingAccountsTable,plan:plansTable,
    userCount:sql<number>`(SELECT count(*)::int FROM users WHERE users.tenant_id="tenants"."id" AND users.is_active=true)`,
    propertyCount:sql<number>`(SELECT count(*)::int FROM properties WHERE properties.tenant_id="tenants"."id" AND properties.archived_at IS NULL)`,
  }).from(tenantsTable).leftJoin(companies,eq(companies.tenantId,tenantsTable.id)).leftJoin(softwareBillingAccountsTable,eq(softwareBillingAccountsTable.tenantId,tenantsTable.id)).leftJoin(plansTable,eq(plansTable.id,softwareBillingAccountsTable.planId));
  const owners=await db.select({id:usersTable.id,name:usersTable.name}).from(usersTable).innerJoin(platformOwnersTable,eq(usersTable.id,platformOwnersTable.userId)).where(eq(usersTable.isActive,true));
  if(!owners.some(u=>u.id===a.userId))owners.push({id:a.userId,name:a.user.name});
  res.set("Cache-Control","no-store").json({
    threads:await db.select().from(threads).orderBy(desc(threads.updatedAt)),messages:await db.select().from(messages).orderBy(messages.createdAt),
    content:await db.select().from(content).orderBy(desc(content.updatedAt)),staffUsers:owners,
    businesses:rows.map(r=>({id:r.tenant.id,name:r.tenant.name,policy:{subscriptionRequired:r.policy?.subscriptionRequired??false,trialUntil:r.policy?.trialUntil?.toISOString()??null,graceDays:r.policy?.graceDays??7,enforceLimits:r.policy?.enforceLimits??false},subscriptionStatus:r.account?.status??"none",planId:r.account?.planId??null,maxUsers:r.plan?.maxUsers??null,maxProperties:r.plan?.maxProperties??null,userCount:r.userCount,propertyCount:r.propertyCount})),
    alerts:await db.select().from(operationsAlertsTable).orderBy(desc(operationsAlertsTable.updatedAt)),
    recoveryDrills:await db.select().from(recoveryDrillsTable).orderBy(desc(recoveryDrillsTable.createdAt)).limit(100),
  });
});
router.post("/experience/actions",async(req,res)=>{
  const parsed=actions.safeParse(req.body);if(!parsed.success){res.status(400).json({error:parsed.error.issues.map(i=>i.message).join("; ")});return;}
  const a=await actor(req),input=parsed.data;
  const adminOnly=["updateThread","saveContent","saveCompanyPolicy","recordRecoveryDrill"];
  if(adminOnly.includes(input.action)&&!a.admin){res.status(403).json({error:"Software-owner access required"});return;}
  if(["saveOnboarding","runChecks"].includes(input.action)&&!a.manager&&!a.admin){res.status(403).json({error:"Company owner or manager required"});return;}
  try{
    if(input.action==="runChecks"){await runOperationsChecks(a.admin?undefined:a.tenantId);res.json({result:{checked:true}});return;}
    const result=await db.transaction(async tx=>{
      if(input.action==="createThread"){
        const p=input.payload;await validateUploads(tx,p.attachments,a.userId,a.tenantId);
        const [row]=await tx.insert(threads).values({id:randomUUID(),tenantId:a.tenantId,userId:a.userId,kind:p.kind,title:p.title,diagnostics:p.diagnosticsConsent?{page:p.page??null,clientVersion:p.clientVersion??null,consent:true}:{}}).returning();
        await tx.insert(messages).values({id:randomUUID(),threadId:row.id,userId:a.userId,body:p.body,attachments:p.attachments});
        for(const owner of await ownerRecipients(tx))if(owner.id!==a.userId)await notifyExperience(tx,owner.id,owner.tenantId,"A new software support request was received.","/software-support");
        await auditAction(tx,a.userId,"thread_created",{threadId:row.id});return row;
      }
      if(input.action==="replyThread"||input.action==="updateThread"){
        const p=input.payload;const [thread]=await tx.select().from(threads).where(eq(threads.id,p.threadId)).for("update");
        if(!thread||(!a.admin&&(thread.userId!==a.userId||thread.tenantId!==a.tenantId)))throw Object.assign(new Error("Support request not found"),{status:404});
        if(input.action==="replyThread"){
          const reply=input.payload;if(reply.internal&&!a.admin)throw Object.assign(new Error("Internal notes require software-owner access"),{status:403});
          await validateUploads(tx,reply.attachments,a.userId,a.tenantId);
          await tx.insert(messages).values({id:randomUUID(),threadId:thread.id,userId:a.userId,body:reply.body,internal:reply.internal,attachments:reply.attachments});
          await tx.update(threads).set({updatedAt:new Date()}).where(eq(threads.id,thread.id));
          if(a.admin&&!reply.internal&&thread.userId!==a.userId)await notifyExperience(tx,thread.userId,thread.tenantId,"Your software support request has a reply.","/help");
          else for(const owner of await ownerRecipients(tx))if(owner.id!==a.userId)await notifyExperience(tx,owner.id,owner.tenantId,"A software support conversation has a new reply.","/software-support");
        }else{
          const update=input.payload;
          if(update.assigneeId){const [assignee]=await tx.select().from(usersTable).where(eq(usersTable.id,update.assigneeId));if(!assignee||!await isSoftwareOwner(assignee.id,assignee.tenantId))throw Object.assign(new Error("Assign only to a software owner"),{status:400});}
          if(update.duplicateOf){const [parent]=await tx.select().from(threads).where(eq(threads.id,update.duplicateOf));if(!parent||parent.id===thread.id||parent.duplicateOf)throw Object.assign(new Error("Choose a different primary request, not another duplicate"),{status:400});const [child]=await tx.select({id:threads.id}).from(threads).where(eq(threads.duplicateOf,thread.id)).limit(1);if(child)throw Object.assign(new Error("A primary request with linked duplicates cannot itself become a duplicate"),{status:400});}
          await tx.update(threads).set({status:update.status,priority:update.priority,...(update.assigneeId!==undefined?{assigneeId:update.assigneeId}:{}),...(update.duplicateOf!==undefined?{duplicateOf:update.duplicateOf}:{}),updatedAt:new Date()}).where(eq(threads.id,thread.id));
          if(thread.status!==update.status){
            await notifyExperience(tx,thread.userId,thread.tenantId,`Your software request is now ${update.status.replace(/_/g," ")}.`,"/help");
            const linked=await tx.update(threads).set({status:update.status,updatedAt:new Date()}).where(eq(threads.duplicateOf,thread.id)).returning();
            for(const link of linked)await notifyExperience(tx,link.userId,link.tenantId,`A request related to yours is now ${update.status.replace(/_/g," ")}.`,"/help");
          }
          if(update.assigneeId&&update.assigneeId!==thread.assigneeId){const [assigned]=await tx.select().from(usersTable).where(eq(usersTable.id,update.assigneeId));await notifyExperience(tx,assigned.id,assigned.tenantId,"A software support request was assigned to you.","/software-support");}
        }
        await auditAction(tx,a.userId,input.action,{threadId:thread.id});return {id:thread.id};
      }
      if(input.action==="saveContent"){
        const p=input.payload,itemId=p.id??randomUUID();
        const [existing]=await tx.select().from(content).where(eq(content.id,itemId)).for("update");
        if(p.id&&!existing)throw Object.assign(new Error("Content not found"),{status:404});
        await tx.insert(content).values({...p,id:itemId}).onConflictDoUpdate({target:content.id,set:{kind:p.kind,title:p.title,body:p.body,published:p.published,updatedAt:new Date()}});
        if(p.kind==="release"&&p.published&&!existing?.published){
          const active=await tx.select({id:usersTable.id,tenantId:usersTable.tenantId}).from(usersTable).where(eq(usersTable.isActive,true));
          for(const person of active)await notifyExperience(tx,person.id,person.tenantId,"A new software update is available in What's New.","/help");
        }
        await auditAction(tx,a.userId,"content_saved",{id:itemId,published:p.published});return {id:itemId};
      }
      if(input.action==="saveOnboarding"){
        await tx.insert(companies).values({tenantId:a.tenantId,completedSteps:[...new Set(input.payload.completedSteps)]}).onConflictDoUpdate({target:companies.tenantId,set:{completedSteps:[...new Set(input.payload.completedSteps)],updatedAt:new Date()}});return {saved:true};
      }
      if(input.action==="saveCompanyPolicy"){
        const p=input.payload;const [tenant]=await tx.select({id:tenantsTable.id}).from(tenantsTable).where(eq(tenantsTable.id,p.tenantId));if(!tenant)throw Object.assign(new Error("Business not found"),{status:404});
        const [old]=await tx.select().from(companies).where(eq(companies.tenantId,p.tenantId)).for("update");
        const values={subscriptionRequired:p.subscriptionRequired,requiredSince:p.subscriptionRequired?(old?.subscriptionRequired?old.requiredSince:new Date()):null,trialUntil:p.trialUntil?new Date(p.trialUntil):null,graceDays:p.graceDays,enforceLimits:p.enforceLimits,updatedAt:new Date()};
        await tx.insert(companies).values({tenantId:p.tenantId,...values}).onConflictDoUpdate({target:companies.tenantId,set:values});
        await auditAction(tx,a.userId,"company_policy_saved",{...p});return {saved:true};
      }
      if(input.action==="recordRecoveryDrill"){const entry={id:randomUUID(),userId:a.userId,...input.payload};await tx.insert(recoveryDrillsTable).values(entry);await auditAction(tx,a.userId,"recovery_evidence_recorded",{id:entry.id,passed:entry.passed});return entry;}
      if(input.action==="resolveAlert"){
        const [alert]=await tx.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.id,input.payload.id));
        if(!alert||(!a.admin&&(!a.manager||alert.tenantId!==a.tenantId)))throw Object.assign(new Error("Alert not found"),{status:404});
        await tx.update(operationsAlertsTable).set({resolved:true,updatedAt:new Date()}).where(eq(operationsAlertsTable.id,alert.id));await auditAction(tx,a.userId,"alert_acknowledged",{id:alert.id});return {resolved:true};
      }
      throw new Error("Unsupported action");
    });
    res.json({result});
  }catch(error){const status=typeof error==="object"&&error&&"status" in error?Number(error.status):500;if(status===500)req.log?.error("Product experience action failed");res.status(status).json({error:status===500?"Unable to save. Please retry.":(error as Error).message});}
});
router.post("/experience/uploads",privateImageUpload);
router.get("/experience/uploads/:id",downloadPrivateImage);
function scrub(value:unknown):unknown{if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!/(password|secret|token|credential|refresh|session|api.?key)/i.test(key)).map(([key,val])=>[key,scrub(val)]));return value;}
router.get("/experience/export",async(req,res)=>{
  const a=await actor(req);if(a.user.role!=="company_owner"){res.status(403).json({error:"Company-owner access required"});return;}
  // Explicit business tables; never include tenant integration config, sessions, HR or platform data.
  const tables=["customers","properties","jobs","invoices","estimates","inventory_items","vendors","expenses"];
  const records:Record<string,unknown>={};
  for(const table of tables){
    const exists=await db.execute(sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} AND column_name='tenant_id'`);
    if(!exists.rows.length)continue;
    const rows=await db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE tenant_id=${a.tenantId}`);records[table]=scrub(rows.rows);
  }
  await db.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId:a.userId,action:"company_records_exported",details:{tenantId:a.tenantId,tables:Object.keys(records)}});
  res.set("Cache-Control","no-store").attachment(`business-records-${new Date().toISOString().slice(0,10)}.json`).json({format:"divine-edge-records-v1",exportedAt:new Date().toISOString(),tenantId:a.tenantId,notice:"Business-record export, not a full database or attachment backup. Recovery requires a verified backup and separate attachment retention.",records});
});
export default router;
