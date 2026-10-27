import { assertSoftwareCapacity } from "../lib/experienceCore";
import { Router } from "express";
import { db,usersTable,tenantsTable,hrAccessTable,employeeProfilesTable,employeeHistoryEntriesTable,employeeFormTemplatesTable,employeeFormAssignmentsTable,hrDocumentsTable,hrApplicationsTable,hrAuditTable,timeEntriesTable,subTimersTable,callbacksTable } from "@workspace/db";
import { and,eq,desc,sql,or } from "drizzle-orm";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { hrAccess,requireHr,requireOwnerHr,HrError,hrAudit,boundedText,calendarDate } from "../lib/hrAccess";
import { createEmployeeRecord,employeeFields,employeeAnswers } from "../lib/employeeRecords";
import { resolveFormEvidence } from "../lib/formEvidence";
import { ensureTenantSlug } from "../lib/tenantSlug";
import { publicAppUrl } from "../lib/publicSite";
import { FormError } from "../lib/jobForms";
import hrDocumentsRouter from "./hrDocuments";
import { credentialContext, credentialDocuments, credentialStatus } from "../lib/hrCredentials";
import bcrypt from "bcryptjs";
const router=Router();
router.use("/hr",requireVerifiedStaff,(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
const id=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new HrError("Invalid record",400);return n;};
async function employeeAccess(tenantId:number,actorId:number,userId:number){
 const access=await hrAccess(tenantId,actorId);
 if(!access.hasHrAccess&&actorId!==userId)throw new HrError("You cannot view another employee's private record",403);
 const [employee]=await db.select({id:usersTable.id,name:usersTable.name,email:usersTable.email,role:usersTable.role,isActive:usersTable.isActive,hourlyRate:usersTable.hourlyRate}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,userId)));
 if(!employee)throw new HrError("Employee not found",404);
 return {employee,access};
}
router.get("/hr/meta",async(req,res)=>{
 const tenantId=getTenantId(req),ownUserId=getUserId(req),access=await hrAccess(tenantId,ownUserId),slug=await ensureTenantSlug(tenantId);
 res.json({...access,ownUserId,publicCareersUrl:`${publicAppUrl}/careers/${encodeURIComponent(slug)}`});
});
router.get("/hr/access",async(req,res)=>{
 const tenantId=getTenantId(req);await requireOwnerHr(tenantId,getUserId(req));
 const members=await db.select({id:usersTable.id,name:usersTable.name,email:usersTable.email,role:usersTable.role,isActive:usersTable.isActive,grantId:hrAccessTable.id})
 .from(usersTable).leftJoin(hrAccessTable,and(eq(hrAccessTable.userId,usersTable.id),eq(hrAccessTable.tenantId,tenantId))).where(eq(usersTable.tenantId,tenantId));
 res.json({members:members.map(({grantId,...member})=>({...member,hasHrAccess:member.role==="company_owner"||!!grantId}))});
});
router.put("/hr/access/:userId",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.userId);
 await requireOwnerHr(tenantId,actorId);
 if(typeof req.body.enabled!=="boolean")throw new HrError("Choose whether to grant HR access");
 await db.transaction(async tx=>{
  const [member]=await tx.select().from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,userId)));
  if(!member)throw new HrError("Staff member not found",404);
  if(member.role==="company_owner")throw new HrError("Owners always have access");
  if(req.body.enabled&&member.isActive===false)throw new HrError("Activate this staff account before granting access");
  if(req.body.enabled)await tx.insert(hrAccessTable).values({tenantId,userId,grantedBy:actorId}).onConflictDoNothing();
  else await tx.delete(hrAccessTable).where(and(eq(hrAccessTable.tenantId,tenantId),eq(hrAccessTable.userId,userId)));
  await hrAudit(tx,tenantId,actorId,req.body.enabled?"hr_access_granted":"hr_access_revoked",userId);
 });
 res.json({success:true});
});
router.get("/hr/employees",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),access=await hrAccess(tenantId,actorId);
 const rows=await db.select({id:usersTable.id,name:usersTable.name,email:usersTable.email,role:usersTable.role,isActive:usersTable.isActive,
 employmentStatus:employeeProfilesTable.employmentStatus,jobTitle:employeeProfilesTable.jobTitle,hireDate:employeeProfilesTable.hireDate})
 .from(usersTable).leftJoin(employeeProfilesTable,and(eq(employeeProfilesTable.userId,usersTable.id),eq(employeeProfilesTable.tenantId,tenantId)))
 .where(and(eq(usersTable.tenantId,tenantId),access.hasHrAccess?undefined:eq(usersTable.id,actorId))).orderBy(usersTable.name);
 res.json({employees:rows.map(row=>({...row,employmentStatus:row.employmentStatus??(row.isActive===false?"former":"active")})),hasHrAccess:access.hasHrAccess});
});
router.get("/hr/employees/:id",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id),{employee,access}=await employeeAccess(tenantId,actorId,userId);
 const [profile]=access.hasHrAccess?await db.select().from(employeeProfilesTable).where(and(eq(employeeProfilesTable.tenantId,tenantId),eq(employeeProfilesTable.userId,userId))):[];
 const history=await db.select({entry:employeeHistoryEntriesTable,createdByName:usersTable.name}).from(employeeHistoryEntriesTable)
 .leftJoin(usersTable,eq(usersTable.id,employeeHistoryEntriesTable.createdById)).where(and(eq(employeeHistoryEntriesTable.tenantId,tenantId),eq(employeeHistoryEntriesTable.userId,userId),
 access.hasHrAccess?undefined:eq(employeeHistoryEntriesTable.sharedWithEmployee,true))).orderBy(desc(employeeHistoryEntriesTable.id));
 const applications=sql`SELECT id FROM hr_applications WHERE tenant_id=${tenantId} AND user_id=${userId}`;
 const documents=await db.select({id:hrDocumentsTable.id,title:hrDocumentsTable.title,fileName:hrDocumentsTable.fileName,mimeType:hrDocumentsTable.mimeType,sizeBytes:hrDocumentsTable.sizeBytes,
 credentialType:hrDocumentsTable.credentialType,expiresOn:hrDocumentsTable.expiresOn,renewsDocumentId:hrDocumentsTable.renewsDocumentId,
 sharedWithEmployee:hrDocumentsTable.sharedWithEmployee,historyEntryId:hrDocumentsTable.historyEntryId,createdAt:hrDocumentsTable.createdAt})
 .from(hrDocumentsTable).where(and(eq(hrDocumentsTable.tenantId,tenantId),or(eq(hrDocumentsTable.employeeId,userId),sql`${hrDocumentsTable.applicationId} IN (${applications})`),
 access.hasHrAccess?undefined:eq(hrDocumentsTable.sharedWithEmployee,true))).orderBy(desc(hrDocumentsTable.id));
 const context=await credentialContext(tenantId);
 const allDocs=await credentialDocuments(tenantId);
 const visibleDocuments=documents.map(doc=>{
  const next=allDocs.find(d=>d.renewsDocumentId===doc.id);
  return {...doc,
   // Do not disclose private successor IDs or private prior IDs to employees.
   renewsDocumentId:access.hasHrAccess||documents.some(d=>d.id===doc.renewsDocumentId)?doc.renewsDocumentId:null,
   renewedByDocumentId:next&&(access.hasHrAccess||documents.some(d=>d.id===next.id))?next.id:null,
   expirationStatus:next&&(access.hasHrAccess||documents.some(d=>d.id===next.id))?"renewed":credentialStatus(doc.expiresOn,context.today,context.warningDays),
  };
 });
 const assignments=await db.select().from(employeeFormAssignmentsTable).where(and(eq(employeeFormAssignmentsTable.tenantId,tenantId),eq(employeeFormAssignmentsTable.userId,userId))).orderBy(desc(employeeFormAssignmentsTable.id));
 const {hourlyRate,...basic}=employee;
 const [pending]=access.hasHrAccess?await db.select({id:hrApplicationsTable.id}).from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.userId,userId),eq(hrApplicationsTable.pendingAccountSetup,true))).limit(1):[];
 res.json({employee:access.hasHrAccess?{...employee,needsAccountSetup:!!pending}:basic,profile:profile??null,history:history.map(({entry,createdByName})=>({...entry,createdByName})),documents:visibleDocuments,assignments,canManage:access.hasHrAccess,credentialWarningDays:context.warningDays});
});
router.patch("/hr/employees/:id/profile",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id);await requireHr(tenantId,actorId);await employeeAccess(tenantId,actorId,userId);
 const keys=["legalName","phone","personalEmail","address","jobTitle","department","emergencyContactName","emergencyContactPhone","notes"] as const;
 const values:Partial<typeof employeeProfilesTable.$inferInsert>={};
 for(const key of keys)if(key in req.body)values[key]=boundedText(req.body[key],key,key==="notes"?20000:2000);
 for(const key of ["hireDate","endDate"] as const)if(key in req.body)values[key]=calendarDate(req.body[key]);
 if("employmentStatus"in req.body){if(!["active","on_leave","former","onboarding"].includes(req.body.employmentStatus))throw new HrError("Choose a valid employment status");values.employmentStatus=req.body.employmentStatus;}
 if(values.personalEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.personalEmail))throw new HrError("Enter a valid personal email");
 const profile=await db.transaction(async tx=>{
  await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.id,userId),eq(usersTable.tenantId,tenantId))).for("update");
  const [before]=await tx.select().from(employeeProfilesTable).where(and(eq(employeeProfilesTable.tenantId,tenantId),eq(employeeProfilesTable.userId,userId)));
  const hire=values.hireDate===undefined?before?.hireDate:values.hireDate,end=values.endDate===undefined?before?.endDate:values.endDate;
  if(hire&&end&&end<hire)throw new HrError("End date cannot be before hire date");
  const [after]=await tx.insert(employeeProfilesTable).values({tenantId,userId,...values}).onConflictDoUpdate({target:[employeeProfilesTable.tenantId,employeeProfilesTable.userId],set:{...values,updatedAt:new Date()}}).returning();
  await hrAudit(tx,tenantId,actorId,"employee_profile_updated",userId,null,before??null,after);return after;
 });
 res.json(profile);
});
router.post("/hr/employees/:id/history",async(req,res)=>res.status(201).json(await createEmployeeRecord(getTenantId(req),getUserId(req),id(req.params.id),req.body)));
router.post("/hr/history/:id/share",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);await requireHr(tenantId,actorId);
 if(typeof req.body.sharedWithEmployee!=="boolean")throw new HrError("Choose whether this record is shared");
 const entry=await db.transaction(async tx=>{
  const [before]=await tx.select().from(employeeHistoryEntriesTable).where(and(eq(employeeHistoryEntriesTable.tenantId,tenantId),eq(employeeHistoryEntriesTable.id,id(req.params.id)))).for("update");
  if(!before)throw new HrError("Personnel record not found",404);
  const [after]=await tx.update(employeeHistoryEntriesTable).set({sharedWithEmployee:req.body.sharedWithEmployee}).where(eq(employeeHistoryEntriesTable.id,before.id)).returning();
  await hrAudit(tx,tenantId,actorId,"personnel_record_sharing_changed",before.userId,null,{shared:before.sharedWithEmployee},{shared:after.sharedWithEmployee});return after;
 });res.json(entry);
});
router.post("/hr/history/:id/acknowledge",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);
 const [entry]=await db.update(employeeHistoryEntriesTable).set({acknowledgedAt:new Date()}).where(and(eq(employeeHistoryEntriesTable.tenantId,tenantId),eq(employeeHistoryEntriesTable.id,id(req.params.id)),
 eq(employeeHistoryEntriesTable.userId,actorId),eq(employeeHistoryEntriesTable.sharedWithEmployee,true),sql`${employeeHistoryEntriesTable.acknowledgedAt} IS NULL`)).returning();
 if(!entry)throw new HrError("A shared, unacknowledged record was not found",404);
 await hrAudit(db,tenantId,actorId,"personnel_record_acknowledged",actorId,null,null,{entryId:entry.id});res.json(entry);
});
router.get("/hr/employees/:id/audit",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id);await requireHr(tenantId,actorId);
 const events=await db.select({event:hrAuditTable,actorName:usersTable.name}).from(hrAuditTable).leftJoin(usersTable,eq(usersTable.id,hrAuditTable.actorId))
 .where(and(eq(hrAuditTable.tenantId,tenantId),or(eq(hrAuditTable.employeeId,userId),
  sql`${hrAuditTable.applicationId} IN (SELECT id FROM hr_applications WHERE tenant_id=${tenantId} AND user_id=${userId})`))).orderBy(desc(hrAuditTable.id));
 res.json({events:events.map(({event,actorName})=>({...event,actorName}))});
});
router.get("/hr/employees/:id/activity",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id);await employeeAccess(tenantId,actorId,userId);
 const today=new Date().toISOString().slice(0,10),from=calendarDate(req.query.from??new Date(Date.now()-30*86400000).toISOString().slice(0,10),false)!,
 to=calendarDate(req.query.to??today,false)!;
 if(to<from||(Date.parse(to)-Date.parse(from))/86400000>366)throw new HrError("Choose a date range of at most one year");
 const [tenant]=await db.select({timezone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
 const zone=tenant?.timezone||"UTC",before=req.query.before?id(req.query.before):null;
 const start=sql`(${from}::date::timestamp AT TIME ZONE ${zone})`,end=sql`((${to}::date+1)::timestamp AT TIME ZONE ${zone})`;
 const entries=await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId,tenantId),eq(timeEntriesTable.userId,userId),
 sql`COALESCE(${timeEntriesTable.adjustedClockedInAt},${timeEntriesTable.clockedInAt})>=${start}`,sql`COALESCE(${timeEntriesTable.adjustedClockedInAt},${timeEntriesTable.clockedInAt})<${end}`,
 before?sql`${timeEntriesTable.id}<${before}`:undefined)).orderBy(desc(timeEntriesTable.id)).limit(201);
 const timers=await db.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),sql`${subTimersTable.startedAt}>=${start}`,sql`${subTimersTable.startedAt}<${end}`)).orderBy(desc(subTimersTable.id)).limit(1000);
 const callbacks=await db.select().from(callbacksTable).where(and(eq(callbacksTable.tenantId,tenantId),eq(callbacksTable.originalAssigneeId,userId),sql`${callbacksTable.createdAt}>=${start}`,sql`${callbacksTable.createdAt}<${end}`)).orderBy(desc(callbacksTable.id)).limit(1000);
 res.json({timeEntries:entries.slice(0,200).map(e=>({...e,clockInAt:e.clockedInAt,clockOutAt:e.clockedOutAt,effectiveClockInAt:e.adjustedClockedInAt??e.clockedInAt,effectiveClockOutAt:e.adjustedClockedOutAt??e.clockedOutAt,
  clockInLocation:e.clockInLat==null||e.clockInLng==null?null:{lat:e.clockInLat,lng:e.clockInLng},clockOutLocation:e.clockOutLat==null||e.clockOutLng==null?null:{lat:e.clockOutLat,lng:e.clockOutLng}})),
  subTimers:timers.map(e=>({...e,startLocation:e.startLat==null||e.startLng==null?null:{lat:e.startLat,lng:e.startLng},stopLocation:e.endLat==null||e.endLng==null?null:{lat:e.endLat,lng:e.endLng}})),callbacks,nextBefore:entries.length>200?entries[199].id:null});
});
router.post("/hr/employees/:id/forms",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id);await requireHr(tenantId,actorId);await employeeAccess(tenantId,actorId,userId);
 const [template]=await db.select().from(employeeFormTemplatesTable).where(and(eq(employeeFormTemplatesTable.tenantId,tenantId),eq(employeeFormTemplatesTable.id,id(req.body.templateId)),eq(employeeFormTemplatesTable.isActive,"true")));
 if(!template)throw new HrError("Employee form template not found",404);
 const fields=employeeFields(template.fields);
 const [assignment]=await db.insert(employeeFormAssignmentsTable).values({tenantId,userId,templateId:template.id,title:template.name,snapshot:{name:template.name,description:template.description,fields},
 required:req.body.required!==false,dueDate:calendarDate(req.body.dueDate),assignedBy:actorId}).returning();
 await hrAudit(db,tenantId,actorId,"employee_form_assigned",userId,null,null,assignment);res.status(201).json(assignment);
});
router.put("/hr/form-assignments/:id",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),access=await hrAccess(tenantId,actorId);
 const assignment=await db.transaction(async tx=>{
  const [before]=await tx.select().from(employeeFormAssignmentsTable).where(and(eq(employeeFormAssignmentsTable.tenantId,tenantId),eq(employeeFormAssignmentsTable.id,id(req.params.id)))).for("update");
  if(!before)throw new HrError("Assigned form not found",404);
  if(!access.hasHrAccess&&before.userId!==actorId)throw new HrError("You cannot submit another employee's form",403);
  if(before.submittedAt)throw new HrError("Submitted forms are preserved. Add a correction record instead.",409);
  const fields=employeeFields((before.snapshot as {fields:unknown}).fields),answers=employeeAnswers(fields,req.body.answers,req.body.submit===true);
  await resolveFormEvidence(tx,tenantId,{scope:"assignment",scopeId:before.id},fields,answers);
  const [after]=await tx.update(employeeFormAssignmentsTable).set({answers,submittedAt:req.body.submit===true?new Date():null,submittedBy:req.body.submit===true?actorId:null})
   .where(eq(employeeFormAssignmentsTable.id,before.id)).returning();
  await hrAudit(tx,tenantId,actorId,req.body.submit===true?"employee_form_submitted":"employee_form_draft_saved",before.userId,null,before,after);return after;
 });res.json(assignment);
});
router.patch("/employee-form-templates/:id",requireVerifiedStaff,async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);await requireHr(tenantId,actorId);
 const [before]=await db.select().from(employeeFormTemplatesTable).where(and(eq(employeeFormTemplatesTable.tenantId,tenantId),eq(employeeFormTemplatesTable.id,id(req.params.id))));
 if(!before)throw new HrError("Employee form template not found",404);
 const values:Partial<typeof employeeFormTemplatesTable.$inferInsert>={};
 if("name"in req.body)values.name=boundedText(req.body.name,"Template name",200,true);
 if("description"in req.body)values.description=boundedText(req.body.description,"Description",4000);
 if("fields"in req.body)values.fields=employeeFields(req.body.fields);
 if("isActive"in req.body||"active"in req.body){const active=req.body.active??req.body.isActive;values.isActive=active===true||active==="true"?"true":"false";}
 if(!Object.keys(values).length){res.json(before);return;}
 const [after]=await db.update(employeeFormTemplatesTable).set(values).where(eq(employeeFormTemplatesTable.id,before.id)).returning();
 await hrAudit(db,tenantId,actorId,"employee_form_template_updated",null,null,before,after);res.json(after);
});
router.use(hrDocumentsRouter);
router.post("/hr/employees/:id/account-setup",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),userId=id(req.params.id);await requireOwnerHr(tenantId,actorId);
 const password=req.body.password;
 if(typeof password!=="string"||password.length<12||password.length>128)throw new HrError("Use a password between 12 and 128 characters");
 const passwordHash=await bcrypt.hash(password,12);
 await db.transaction(async tx=>{
  const [employee]=await tx.select({id:usersTable.id,role:usersTable.role,isActive:usersTable.isActive}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,userId))).for("update");
  if(!employee||employee.role==="company_owner")throw new HrError("Pending staff account not found",404);
  const [pending]=await tx.select({id:hrApplicationsTable.id}).from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.userId,userId),eq(hrApplicationsTable.pendingAccountSetup,true))).for("update");
  if(!pending)throw new HrError("This employee does not have a pending hire login to set up",409);
  if(!employee.isActive)await assertSoftwareCapacity(tx,tenantId,"users");
  await tx.update(usersTable).set({passwordHash,isActive:true}).where(eq(usersTable.id,userId));
  await tx.update(hrApplicationsTable).set({pendingAccountSetup:false}).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.userId,userId)));
  await hrAudit(tx,tenantId,actorId,"pending_hire_account_activated",userId,null,{isActive:employee.isActive},{isActive:true,passwordSet:true});
 });
 res.json({success:true,needsAccountSetup:false});
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof HrError||error instanceof FormError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
