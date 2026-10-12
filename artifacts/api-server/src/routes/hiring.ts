import { Router } from "express";
import { db,tenantsTable,hrSettingsTable,hrPostingsTable,hrApplicationsTable,hrDocumentsTable,hrAuditTable,usersTable,employeeProfilesTable } from "@workspace/db";
import { and,eq,desc,sql } from "drizzle-orm";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { requireHr,requireOwnerHr,HrError,hrAudit,boundedText } from "../lib/hrAccess";
import { hiringSettings,hiringFields,intakeApplication } from "../lib/hiring";
import { FormError } from "../lib/jobForms";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
const router=Router();
router.use("/hr",requireVerifiedStaff,async(req,res,next)=>{res.set("Cache-Control","private, no-store");await requireHr(getTenantId(req),getUserId(req));next();});
router.get("/hr/settings",async(req,res)=>res.json(await hiringSettings(getTenantId(req))));
router.patch("/hr/settings",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);if("publicHiringEnabled"in req.body)await requireOwnerHr(tenantId,actorId);
 const before=await hiringSettings(tenantId),values:Partial<typeof hrSettingsTable.$inferInsert>={};
 if("publicHiringEnabled"in req.body){if(typeof req.body.publicHiringEnabled!=="boolean")throw new HrError("Choose whether to accept applications online");values.publicHiringEnabled=req.body.publicHiringEnabled;}
 if("applicationIntro"in req.body)values.applicationIntro=boundedText(req.body.applicationIntro,"Application introduction",10000);
 if("privacyNotice"in req.body)values.privacyNotice=boundedText(req.body.privacyNotice,"Privacy notice",10000,true);
 if("applicationFields"in req.body)values.applicationFields=hiringFields(req.body.applicationFields);
 if(!Object.keys(values).length){res.json(before);return;}
 const [after]=await db.update(hrSettingsTable).set(values).where(eq(hrSettingsTable.tenantId,tenantId)).returning();
 await hrAudit(db,tenantId,actorId,"hiring_settings_updated",null,null,before,after);res.json(after);
});
router.get("/hr/postings",async(req,res)=>res.json({postings:await db.select().from(hrPostingsTable).where(eq(hrPostingsTable.tenantId,getTenantId(req))).orderBy(desc(hrPostingsTable.id))}));
const postingInput=(body:Record<string,unknown>,before?:typeof hrPostingsTable.$inferSelect)=>{
 const title=boundedText(body.title??before?.title,"Position title",200,true),description=boundedText(body.description??before?.description,"Position description",20000);
 const status=String(body.status??before?.status??"open");if(!["open","closed"].includes(status))throw new HrError("Choose open or closed");
 return {title,description,status,fields:hiringFields(body.fields??before?.fields??[])};
};
router.post("/hr/postings",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);const [posting]=await db.insert(hrPostingsTable).values({tenantId,...postingInput(req.body)}).returning();
 await hrAudit(db,tenantId,actorId,"hiring_position_created",null,null,null,posting);res.status(201).json(posting);
});
router.patch("/hr/postings/:id",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);const [before]=await db.select().from(hrPostingsTable).where(and(eq(hrPostingsTable.tenantId,tenantId),eq(hrPostingsTable.id,Number(req.params.id))));
 if(!before)throw new HrError("Position not found",404);
 const [after]=await db.update(hrPostingsTable).set({...postingInput(req.body,before),updatedAt:new Date()}).where(eq(hrPostingsTable.id,before.id)).returning();
 await hrAudit(db,tenantId,actorId,"hiring_position_updated",null,null,before,after);res.json(after);
});
router.get("/hr/applications",async(req,res)=>{
 const tenantId=getTenantId(req);
 const applications=await db.select({id:hrApplicationsTable.id,fullName:hrApplicationsTable.fullName,email:hrApplicationsTable.email,phone:hrApplicationsTable.phone,
 postingTitle:hrPostingsTable.title,postingId:hrApplicationsTable.postingId,stage:hrApplicationsTable.stage,source:hrApplicationsTable.source,createdAt:hrApplicationsTable.createdAt,userId:hrApplicationsTable.userId})
 .from(hrApplicationsTable).leftJoin(hrPostingsTable,and(eq(hrPostingsTable.id,hrApplicationsTable.postingId),eq(hrPostingsTable.tenantId,tenantId)))
 .where(and(eq(hrApplicationsTable.tenantId,tenantId),req.query.stage?eq(hrApplicationsTable.stage,String(req.query.stage)):undefined,
 req.query.postingId?eq(hrApplicationsTable.postingId,Number(req.query.postingId)):undefined)).orderBy(desc(hrApplicationsTable.id));
 res.json({applications});
});
router.get("/hr/applications/:id",async(req,res)=>{
 const tenantId=getTenantId(req),id=Number(req.params.id);
 const [application]=await db.select().from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,id)));
 if(!application)throw new HrError("Application not found",404);
 const documents=await db.select({id:hrDocumentsTable.id,title:hrDocumentsTable.title,fileName:hrDocumentsTable.fileName,mimeType:hrDocumentsTable.mimeType,sizeBytes:hrDocumentsTable.sizeBytes,createdAt:hrDocumentsTable.createdAt})
 .from(hrDocumentsTable).where(and(eq(hrDocumentsTable.tenantId,tenantId),eq(hrDocumentsTable.applicationId,id)));
 const audit=await db.select({event:hrAuditTable,actorName:usersTable.name}).from(hrAuditTable).leftJoin(usersTable,eq(usersTable.id,hrAuditTable.actorId))
 .where(and(eq(hrAuditTable.tenantId,tenantId),eq(hrAuditTable.applicationId,id))).orderBy(desc(hrAuditTable.id));
 const {payloadHash,requestId,...safe}=application;
 res.json({application:safe,documents,audit:audit.map(({event,actorName})=>({...event,actorName}))});
});
router.post("/hr/applications",async(req,res)=>res.status(201).json(await intakeApplication(getTenantId(req),getUserId(req),req.body,"staff")));
router.patch("/hr/applications/:id",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);
 const application=await db.transaction(async tx=>{
  const [before]=await tx.select().from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,Number(req.params.id)))).for("update");
  if(!before)throw new HrError("Application not found",404);
  const values:Partial<typeof hrApplicationsTable.$inferInsert>={updatedAt:new Date()};
  if("stage"in req.body){
   if(!["applied","screening","interview","offer","declined","withdrawn"].includes(req.body.stage))throw new HrError("Use the explicit Hire action to record a hire");
   if(before.userId)throw new HrError("This application is linked to an employee. Keep its hire history and add a note instead.",409);
   values.stage=req.body.stage;
  }
  if("notes"in req.body)values.notes=boundedText(req.body.notes,"Application notes",20000);
  const [after]=await tx.update(hrApplicationsTable).set(values).where(eq(hrApplicationsTable.id,before.id)).returning();
  await hrAudit(tx,tenantId,actorId,"application_updated",null,before.id,before,after);return after;
 });res.json(application);
});
router.post("/hr/applications/:id/hire",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);
 const result=await db.transaction(async tx=>{
  const [application]=await tx.select().from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,Number(req.params.id)))).for("update");
  if(!application)throw new HrError("Application not found",404);
  if(application.userId)return {userId:application.userId,needsAccountSetup:application.pendingAccountSetup};
  let userId:number;
  if(req.body.existingUserId){
   await requireOwnerHr(tenantId,actorId,tx);
   const [employee]=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,Number(req.body.existingUserId))));
   if(!employee)throw new HrError("Existing employee not found",404);userId=employee.id;
  }else{
   // Serialize account creation by company/email; never take over an existing login.
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('hiring-account'),hashtext(${tenantId+":"+application.email}))`);
   const [existing]=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.email,application.email)));
   if(existing)throw new HrError("A staff account already uses this email. Ask the owner to link that employee explicitly.",409);
   const unusablePasswordHash=await bcrypt.hash(randomBytes(48).toString("base64url"),12);
   const [created]=await tx.insert(usersTable).values({tenantId,name:application.fullName,email:application.email,role:"technician",isActive:false,passwordHash:unusablePasswordHash}).returning();userId=created.id;
   const [posting]=application.postingId?await tx.select({title:hrPostingsTable.title}).from(hrPostingsTable).where(and(eq(hrPostingsTable.id,application.postingId),eq(hrPostingsTable.tenantId,tenantId))):[];
   const [company]=await tx.select({timezone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
   const dateParts=new Intl.DateTimeFormat("en-CA",{timeZone:company?.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
   const hireDate=["year","month","day"].map(type=>dateParts.find(part=>part.type===type)!.value).join("-");
   await tx.insert(employeeProfilesTable).values({tenantId,userId,legalName:application.fullName,personalEmail:application.email,phone:application.phone,
    jobTitle:posting?.title??null,employmentStatus:"onboarding",hireDate}).onConflictDoNothing();
  }
  await tx.update(hrApplicationsTable).set({stage:"hired",userId,pendingAccountSetup:!req.body.existingUserId,updatedAt:new Date()}).where(eq(hrApplicationsTable.id,application.id));
  await hrAudit(tx,tenantId,actorId,"human_hiring_decision",userId,application.id,{stage:application.stage},{stage:"hired",userId,accountActivated:false});
  return {userId,needsAccountSetup:!req.body.existingUserId};
 });res.json(result);
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof HrError||error instanceof FormError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
