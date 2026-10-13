import { db, formEvidenceTable, jobFormsTable, jobsTable, crewMembersTable, employeeFormAssignmentsTable, employeeFormTemplatesTable, employeeHistoryEntriesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { FormError, type FormField, type FormsDb } from "./jobForms";
import { hrAccess, requireHr } from "./hrAccess";
import { hrStorage, hrFile } from "./hrFiles";

export type EvidenceScope = { scope: "job" | "assignment" | "employee"; scopeId: number; employeeId?: number };
export async function jobEvidenceAccess(tenantId:number,actorId:number,jobId:number,handle:FormsDb=db){
 const [job]=await handle.select().from(jobsTable).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,jobId)));
 if(!job)throw new FormError("Job not found");
 const [user]=await handle.select({role:usersTable.role}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,actorId)));
 const role=user?.role??"";
 if(!["company_owner","office_manager","department_manager","crew_manager"].includes(role)&&job.assigneeId!==actorId){
  const members=job.crewId?await handle.select().from(crewMembersTable).where(and(eq(crewMembersTable.tenantId,tenantId),eq(crewMembersTable.crewId,job.crewId),eq(crewMembersTable.userId,actorId))):[];
  if(!members.length)throw new FormError("You are not assigned to this job");
 }
 return job;
}
export async function evidenceFields(tenantId:number,actorId:number,target:EvidenceScope,handle:FormsDb=db){
 if(target.scope==="job"){
  const [form]=await handle.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.id,target.scopeId)));
  if(!form)throw new FormError("Form not found");
  const job=await jobEvidenceAccess(tenantId,actorId,form.jobId,handle);
  if(["completed","cancelled"].includes(job.status))throw new FormError("Completed forms are historical records");
  return (form.snapshot as {fields:FormField[]}).fields;
 }
 if(target.scope==="assignment"){
  const [form]=await handle.select().from(employeeFormAssignmentsTable).where(and(eq(employeeFormAssignmentsTable.tenantId,tenantId),eq(employeeFormAssignmentsTable.id,target.scopeId)));
  if(!form)throw new FormError("Assigned form not found");
  if(!(await hrAccess(tenantId,actorId,handle)).hasHrAccess&&form.userId!==actorId)throw new FormError("This employee form is private");
  if(form.submittedAt)throw new FormError("Submitted employee forms are preserved");
  return (form.snapshot as {fields:FormField[]}).fields;
 }
 await requireHr(tenantId,actorId,handle);
 const [employee]=await handle.select().from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,target.employeeId??0)));
 const [template]=await handle.select().from(employeeFormTemplatesTable).where(and(eq(employeeFormTemplatesTable.tenantId,tenantId),eq(employeeFormTemplatesTable.id,target.scopeId),eq(employeeFormTemplatesTable.isActive,"true")));
 if(!employee||!template)throw new FormError("Employee or active form not found");
 return template.fields as FormField[];
}
export function evidenceOutput(row:typeof formEvidenceTable.$inferSelect){
 return {evidenceId:row.id,fileName:row.fileName,kind:row.kind,label:row.label,actorId:row.actorId,capturedAt:row.finalizedAt?.toISOString(),sha256:row.sha256,sizeBytes:row.sizeBytes,mimeType:row.mimeType};
}
export async function resolveFormEvidence(handle:FormsDb,tenantId:number,target:EvidenceScope,fields:FormField[],answers:Record<string,unknown>){
 for(const field of fields.filter(f=>["photo","signature"].includes(f.type))){
  const answer=answers[field.id] as {evidenceId:number}|undefined;
  if(!answer)continue;
  const [row]=await handle.select().from(formEvidenceTable).where(and(eq(formEvidenceTable.id,answer.evidenceId),eq(formEvidenceTable.tenantId,tenantId)));
  if(!row?.objectPath||!row.finalizedAt||row.scope!==target.scope||row.scopeId!==target.scopeId||row.employeeId!==(target.employeeId??null)||row.fieldId!==field.id||row.label!==field.label||row.kind!==field.type)throw new FormError(`Upload valid evidence for ${field.label}`);
  // Required uploads are not fulfilled by an ID alone: the sealed bytes must exist.
  await hrStorage.getObjectEntityFile(row.objectPath);
  answers[field.id]=evidenceOutput(row);
 }
 return answers;
}
export async function finalizeEvidence(tenantId:number,actorId:number,id:number,handle:FormsDb=db){
 return handle.transaction(async tx=>{
  const [row]=await tx.select().from(formEvidenceTable).where(and(eq(formEvidenceTable.id,id),eq(formEvidenceTable.tenantId,tenantId),eq(formEvidenceTable.actorId,actorId))).for("update");
  if(!row)throw new FormError("Upload not found");
  if(row.finalizedAt)return evidenceOutput(row);
  if(Date.now()-row.createdAt.getTime()>15*60*1000)throw new FormError("Upload expired. Please upload again.");
  const fields=await evidenceFields(tenantId,actorId,{scope:row.scope as EvidenceScope["scope"],scopeId:row.scopeId,...(row.employeeId?{employeeId:row.employeeId}:{})},tx);
  if(!fields.some(f=>f.id===row.fieldId&&f.label===row.label&&f.type===row.kind))throw new FormError("The question changed. Upload evidence for the current wording.");
  const source=await hrStorage.getObjectEntityFile(row.uploadPath);
  const [metadata]=await source.getMetadata();
  if(Number(metadata.size)>10*1024*1024)throw new FormError("Image must be at most 10 MB");
  const [bytes]=await source.download();
  const file=hrFile({buffer:bytes,originalname:row.fileName} as Express.Multer.File);
  if(!file.mimeType.startsWith("image/")||file.mimeType!==row.mimeType||!bytes.length||bytes.length>10*1024*1024)throw new FormError("Upload a valid PNG, JPG, or WebP image");
  const objectPath=await hrStorage.saveHrDocument(bytes,file.mimeType);
  const [sealed]=await tx.update(formEvidenceTable).set({objectPath,sha256:createHash("sha256").update(bytes).digest("hex"),sizeBytes:bytes.length,finalizedAt:new Date()}).where(eq(formEvidenceTable.id,row.id)).returning();
  return evidenceOutput(sealed);
 });
}
export async function readableEvidence(tenantId:number,actorId:number,id:number,handle:FormsDb=db){
 const [row]=await handle.select().from(formEvidenceTable).where(and(eq(formEvidenceTable.tenantId,tenantId),eq(formEvidenceTable.id,id)));
 if(!row?.objectPath)throw new FormError("Evidence not found");
 if(row.scope==="job"){
  const [form]=await handle.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.id,row.scopeId)));
  if(!form)throw new FormError("Form not found");
  await jobEvidenceAccess(tenantId,actorId,form.jobId,handle);
 }else if(!(await hrAccess(tenantId,actorId,handle)).hasHrAccess){
  if(row.scope==="assignment"){
   const [form]=await handle.select().from(employeeFormAssignmentsTable).where(and(eq(employeeFormAssignmentsTable.tenantId,tenantId),eq(employeeFormAssignmentsTable.id,row.scopeId),eq(employeeFormAssignmentsTable.userId,actorId)));
   if(!form)throw new FormError("This evidence is HR-private");
  }else{
   const records=await handle.select().from(employeeHistoryEntriesTable).where(and(eq(employeeHistoryEntriesTable.tenantId,tenantId),eq(employeeHistoryEntriesTable.userId,actorId),eq(employeeHistoryEntriesTable.sharedWithEmployee,true)));
   if(!records.some(r=>Object.values((r.formData??{}) as Record<string,{evidenceId?:number}>).some(v=>v&&typeof v==="object"&&v.evidenceId===id)))throw new FormError("This evidence is HR-private");
  }
 }
 return row;
}
