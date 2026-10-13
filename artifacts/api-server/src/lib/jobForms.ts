import { db,jobsTable,jobFormTemplatesTable,jobFormsTable } from "@workspace/db";
import { and,eq,sql,type SQL } from "drizzle-orm";
export type FormsDb=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FormField={id:string;label:string;type:"text"|"textarea"|"number"|"select"|"multi_select"|"yes_no"|"date"|"photo"|"signature";required:boolean;options?:string[]};
export class FormError extends Error{status=409;statusCode=409;missing:string[]=[];}
export function validateFields(fields:unknown):FormField[]{
 if(!Array.isArray(fields)||fields.length<1||fields.length>50)throw new FormError("Add between 1 and 50 fields");
 const seen=new Set<string>();
 return fields.map(raw=>{
  if(!raw||typeof raw!=="object")throw new FormError("Invalid form field");
  const field=raw as FormField;
  if(typeof field.id!=="string"||!/^[\w-]{1,64}$/.test(field.id)||seen.has(field.id)||["__proto__","constructor","prototype"].includes(field.id))throw new FormError("Each field needs a unique identifier");
  seen.add(field.id);
  if(typeof field.label!=="string"||!field.label.trim()||field.label.length>200)throw new FormError("Each field needs a label");
  if(!["text","textarea","number","select","multi_select","yes_no","date","photo","signature"].includes(field.type))throw new FormError("Unsupported field type");
  const options=field.options??[];
  if(!Array.isArray(options)||options.length>100||options.some(value=>typeof value!=="string"||!value.trim()||value.length>200)||new Set(options).size!==options.length)throw new FormError("Choices must be unique, nonempty text");
  if(["select","multi_select"].includes(field.type)&&!options.length)throw new FormError("Choice fields need choices");
  return {id:field.id,label:field.label.trim(),type:field.type,required:field.required===true,...(options.length?{options}: {})};
 });
}
export function validateAnswers(fields:FormField[],input:unknown,submit:boolean){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new FormError("Enter form answers");
 const answers:Record<string,unknown>={};
 for(const field of fields){
  const value=(input as Record<string,unknown>)[field.id],empty=value===undefined||value===null||(typeof value==="string"&&!value.trim())||(Array.isArray(value)&&!value.length);
  if(empty){if(submit&&field.required)throw new FormError(`${field.label} is required`);continue;}
  if(["photo","signature"].includes(field.type)){
   if(!value||typeof value!=="object"||Array.isArray(value)||!Number.isSafeInteger((value as {evidenceId?:number}).evidenceId)||Number((value as {evidenceId?:number}).evidenceId)<1)throw new FormError(`Upload evidence for ${field.label}`);
   answers[field.id]={evidenceId:(value as {evidenceId:number}).evidenceId};continue;
  }
  if(field.type==="number"&&(typeof value!=="number"||!Number.isFinite(value)))throw new FormError(`${field.label} must be a number`);
  if(field.type==="yes_no"&&typeof value!=="boolean")throw new FormError(`Choose yes or no for ${field.label}`);
  if(["text","textarea","date","select"].includes(field.type)&&(typeof value!=="string"||value.length>10000))throw new FormError(`Invalid answer for ${field.label}`);
  if(field.type==="date"&&(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new FormError(`Choose a valid date for ${field.label}`);
  if(field.type==="select"&&!field.options?.includes(value as string))throw new FormError(`Choose an available option for ${field.label}`);
  if(field.type==="multi_select"&&(!Array.isArray(value)||value.some(v=>typeof v!=="string"||!field.options?.includes(v))))throw new FormError(`Choose available options for ${field.label}`);
  answers[field.id]=value;
 }
 return answers;
}
export async function ensureJobForms(handle:FormsDb,job:typeof jobsTable.$inferSelect){
 if(["completed","cancelled"].includes(job.status))return;
 const templates=await handle.select().from(jobFormTemplatesTable).where(and(eq(jobFormTemplatesTable.tenantId,job.tenantId),eq(jobFormTemplatesTable.active,true)));
 for(const template of templates){
  if(template.assignment!=="all_jobs"&&!(template.assignment==="services"&&job.serviceId&&(template.serviceIds as number[]).includes(job.serviceId)))continue;
  await handle.insert(jobFormsTable).values({tenantId:job.tenantId,jobId:job.id,templateId:template.id,
   snapshot:{name:template.name,description:template.description,fields:template.fields},required:template.required}).onConflictDoNothing();
 }
}
export async function assertJobFormsComplete(handle:FormsDb,job:typeof jobsTable.$inferSelect){
 await ensureJobForms(handle,job);
 const missing=await handle.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,job.tenantId),eq(jobFormsTable.jobId,job.id),eq(jobFormsTable.required,true),sql`${jobFormsTable.submittedAt} IS NULL`));
 if(missing.length){const names=missing.map(f=>(f.snapshot as {name:string}).name);const error=new FormError(`Complete required job forms first: ${names.join(", ")}`);error.missing=names;throw error;}
 const required=await handle.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,job.tenantId),eq(jobFormsTable.jobId,job.id),eq(jobFormsTable.required,true)));
 const {resolveFormEvidence}=await import("./formEvidence");
 for(const form of required){
  const fields=(form.snapshot as {fields:FormField[]}).fields;
  const answers=validateAnswers(fields,form.answers,true);
  await resolveFormEvidence(handle,job.tenantId,{scope:"job",scopeId:form.id},fields,answers);
 }
}
export async function assertCompletedJobCreationAllowed(tenantId:number,serviceId:unknown){
 const templates=await db.select().from(jobFormTemplatesTable).where(and(eq(jobFormTemplatesTable.tenantId,tenantId),eq(jobFormTemplatesTable.active,true),eq(jobFormTemplatesTable.required,true)));
 if(templates.some(t=>t.assignment==="all_jobs"||(t.assignment==="services"&&(t.serviceIds as number[]).includes(Number(serviceId)))))
  throw new FormError("Create this job as scheduled first, then fill out its required forms before completing it");
}
/** Every completion write checks forms under the same job row lock as its status update. */
export function formsGuardedJobUpdate(handle:FormsDb){
 return {set(values:Partial<typeof jobsTable.$inferInsert>){
  if(values.status!=="completed")return handle.update(jobsTable).set(values);
  return {where(condition:SQL|undefined){
   const promise=handle.transaction(async tx=>{
    const jobs=await tx.select().from(jobsTable).where(condition).for("update");
    for(const job of jobs)if(job.status!=="completed")await assertJobFormsComplete(tx,job);
    return tx.update(jobsTable).set(values).where(condition).returning();
   });
   return {returning:()=>promise,then:promise.then.bind(promise)};
  }};
 }};
}
