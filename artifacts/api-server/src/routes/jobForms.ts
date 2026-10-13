import { Router } from "express";
import { db,jobsTable,jobFormTemplatesTable,jobFormsTable,jobFormAuditTable,crewMembersTable,servicesTable,usersTable } from "@workspace/db";
import { and,eq,desc } from "drizzle-orm";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { getCallerRole } from "../lib/roles";
import { ensureJobForms,FormError,validateFields,validateAnswers,type FormField } from "../lib/jobForms";
import { resolveFormEvidence } from "../lib/formEvidence";
const router=Router();
const managers=new Set(["company_owner","office_manager","department_manager"]);
const canManage=async(tenant:number,user:number)=>managers.has(await getCallerRole(tenant,user));
async function access(tenant:number,user:number,jobId:number){
 const [job]=await db.select().from(jobsTable).where(and(eq(jobsTable.tenantId,tenant),eq(jobsTable.id,jobId)));
 if(!job)throw Object.assign(new FormError("Job not found"),{status:404});
 const role=await getCallerRole(tenant,user);
 if(!managers.has(role)&&role!=="crew_manager"&&job.assigneeId!==user){
  const crew=job.crewId?await db.select({id:crewMembersTable.id}).from(crewMembersTable).where(and(eq(crewMembersTable.tenantId,tenant),eq(crewMembersTable.crewId,job.crewId),eq(crewMembersTable.userId,user))).limit(1):[];
  if(!crew.length)throw Object.assign(new FormError("You are not assigned to this job"),{status:403});
 }
 return job;
}
const formOutput=async(form:typeof jobFormsTable.$inferSelect)=>{
 const [actor]=form.submittedBy?await db.select({name:usersTable.name}).from(usersTable).where(and(eq(usersTable.id,form.submittedBy),eq(usersTable.tenantId,form.tenantId))).limit(1):[];
 return {...form,...form.snapshot as object,submittedBy:actor?.name??null,submittedById:form.submittedBy};
};
router.get("/form-templates",async(req,res)=>{
 const tenantId=getTenantId(req);res.json({templates:await db.select().from(jobFormTemplatesTable).where(eq(jobFormTemplatesTable.tenantId,tenantId)).orderBy(desc(jobFormTemplatesTable.updatedAt)),canManage:await canManage(tenantId,getUserId(req))});
});
async function definition(tenantId:number,body:Record<string,unknown>){
 if(typeof body.name!=="string"||!body.name.trim()||body.name.length>150)throw new FormError("A form name is required (up to 150 characters)");
 if(body.description!==undefined&&(typeof body.description!=="string"||body.description.length>4000))throw new FormError("Description is too long");
 if(!["manual","all_jobs","services"].includes(String(body.assignment)))throw new FormError("Choose how this form is assigned");
 const serviceIds=body.serviceIds??[];
 if(!Array.isArray(serviceIds)||serviceIds.length>100||serviceIds.some(id=>!Number.isInteger(id)||id<=0))throw new FormError("Choose valid services");
 for(const id of serviceIds){
  if(!(await db.select({id:servicesTable.id}).from(servicesTable).where(and(eq(servicesTable.tenantId,tenantId),eq(servicesTable.id,id))).limit(1)).length)throw new FormError("A selected service does not belong to this business");
 }
 if(body.assignment==="services"&&!serviceIds.length)throw new FormError("Choose at least one service");
 return {name:body.name.trim(),description:typeof body.description==="string"?body.description:"",fields:validateFields(body.fields),
  assignment:String(body.assignment),serviceIds,required:body.required===true,active:body.active!==false,updatedAt:new Date()};
}
router.post("/form-templates",async(req,res)=>{
 const tenantId=getTenantId(req);if(!(await canManage(tenantId,getUserId(req)))){res.status(403).json({error:"Only managers can edit form templates"});return;}
 const values=await definition(tenantId,req.body);const [template]=await db.insert(jobFormTemplatesTable).values({tenantId,...values}).returning();res.status(201).json(template);
});
router.patch("/form-templates/:id",async(req,res)=>{
 const tenantId=getTenantId(req);if(!(await canManage(tenantId,getUserId(req)))){res.status(403).json({error:"Only managers can edit form templates"});return;}
 const [current]=await db.select().from(jobFormTemplatesTable).where(and(eq(jobFormTemplatesTable.tenantId,tenantId),eq(jobFormTemplatesTable.id,Number(req.params.id))));
 if(!current){res.status(404).json({error:"Form template not found"});return;}
 const values=await definition(tenantId,{...current,...req.body});const [template]=await db.update(jobFormTemplatesTable).set(values).where(eq(jobFormTemplatesTable.id,current.id)).returning();res.json(template);
});
router.get("/jobs/:id/forms",async(req,res)=>{
 const tenantId=getTenantId(req),userId=getUserId(req),job=await access(tenantId,userId,Number(req.params.id));
 const forms=await db.transaction(async tx=>{
  const [locked]=await tx.select().from(jobsTable).where(eq(jobsTable.id,job.id)).for("update");
  await ensureJobForms(tx,locked);
  return tx.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.jobId,job.id))).orderBy(jobFormsTable.id);
 });
 res.json({forms:await Promise.all(forms.map(formOutput)),missingRequired:forms.filter(form=>form.required&&!form.submittedAt).map(form=>form.id),canManage:await canManage(tenantId,userId)});
});
router.post("/jobs/:id/forms",async(req,res)=>{
 const tenantId=getTenantId(req),userId=getUserId(req),job=await access(tenantId,userId,Number(req.params.id));
 const manage=await canManage(tenantId,userId);
 if(req.body.required!==undefined&&!manage){res.status(403).json({error:"Only managers can change required forms"});return;}
 const [template]=await db.select().from(jobFormTemplatesTable).where(and(eq(jobFormTemplatesTable.tenantId,tenantId),eq(jobFormTemplatesTable.id,Number(req.body.templateId)),eq(jobFormTemplatesTable.active,true)));
 if(!template){res.status(404).json({error:"Active template not found"});return;}
 const form=await db.transaction(async tx=>{
  const [locked]=await tx.select().from(jobsTable).where(eq(jobsTable.id,job.id)).for("update");
  if(["completed","cancelled"].includes(locked.status))throw new FormError("Completed job forms are historical records");
  await tx.insert(jobFormsTable).values({tenantId,jobId:job.id,templateId:template.id,snapshot:{name:template.name,description:template.description,fields:template.fields},
   required:req.body.required===undefined?template.required:req.body.required===true}).onConflictDoNothing();
  const [result]=await tx.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.jobId,job.id),eq(jobFormsTable.templateId,template.id)));return result;
 });
 res.status(201).json(await formOutput(form));
});
router.put("/jobs/:id/forms/:formId",async(req,res)=>{
 const tenantId=getTenantId(req),userId=getUserId(req),job=await access(tenantId,userId,Number(req.params.id));
 const result=await db.transaction(async tx=>{
  const [locked]=await tx.select().from(jobsTable).where(eq(jobsTable.id,job.id)).for("update");
  if(["completed","cancelled"].includes(locked.status))throw new FormError("Completed job forms are historical records");
  const [form]=await tx.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.jobId,job.id),eq(jobFormsTable.id,Number(req.params.formId)))).for("update");
  if(!form)throw Object.assign(new FormError("Form not found"),{status:404});
  const answers=validateAnswers((form.snapshot as {fields:FormField[]}).fields,req.body.answers,req.body.submit===true);
  await resolveFormEvidence(tx,tenantId,{scope:"job",scopeId:form.id},(form.snapshot as {fields:FormField[]}).fields,answers);
  await tx.insert(jobFormAuditTable).values({tenantId,formId:form.id,actorId:userId,event:req.body.submit===true?"submitted":"draft_saved",previous:{snapshot:form.snapshot,answers:form.answers,submittedAt:form.submittedAt,submittedBy:form.submittedBy}});
  const [updated]=await tx.update(jobFormsTable).set({answers,submittedAt:req.body.submit===true?new Date():null,submittedBy:req.body.submit===true?userId:null,updatedAt:new Date()}).where(eq(jobFormsTable.id,form.id)).returning();return updated;
 });
 res.json(await formOutput(result));
});
router.patch("/jobs/:id/forms/:formId/requirement",async(req,res)=>{
 const tenantId=getTenantId(req),userId=getUserId(req),job=await access(tenantId,userId,Number(req.params.id));
 if(!(await canManage(tenantId,userId))){res.status(403).json({error:"Only managers can change required forms"});return;}
 if(typeof req.body.required!=="boolean"||typeof req.body.reason!=="string"||!req.body.reason.trim()||req.body.reason.length>1000){res.status(400).json({error:"A reason is required"});return;}
 const updated=await db.transaction(async tx=>{
  const [locked]=await tx.select().from(jobsTable).where(eq(jobsTable.id,job.id)).for("update");
  if(["completed","cancelled"].includes(locked.status))throw new FormError("Completed job forms are historical records");
  const [form]=await tx.select().from(jobFormsTable).where(and(eq(jobFormsTable.tenantId,tenantId),eq(jobFormsTable.jobId,job.id),eq(jobFormsTable.id,Number(req.params.formId)))).for("update");
  if(!form)throw Object.assign(new FormError("Form not found"),{status:404});
  await tx.insert(jobFormAuditTable).values({tenantId,formId:form.id,actorId:userId,event:"requirement_changed",previous:{required:form.required,reason:req.body.reason.trim()}});
  const [result]=await tx.update(jobFormsTable).set({required:req.body.required,updatedAt:new Date()}).where(eq(jobFormsTable.id,form.id)).returning();return result;
 });
 res.json(await formOutput(updated));
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof FormError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
