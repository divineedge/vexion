import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, tenantsTable, usersTable, customersTable, jobsTable, jobFormTemplatesTable, jobFormsTable, formEvidenceTable, employeeFormTemplatesTable, employeeFormAssignmentsTable, employeeHistoryEntriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validateFields, validateAnswers, assertJobFormsComplete, type FormField } from "./jobForms";
import { evidenceFields, finalizeEvidence, readableEvidence, resolveFormEvidence } from "./formEvidence";
import { hrStorage } from "./hrFiles";

afterEach(()=>vi.restoreAllMocks());
const fields:FormField[]=[
 {id:"photo",label:"Site photo",type:"photo",required:true},
 {id:"mark",label:"Record your signature (not agreement)",type:"signature",required:false},
];
describe("photo and signature form evidence",()=>{
 it("accepts optional/required question types and rejects missing or forged answer values",()=>{
  expect(validateFields(fields)).toEqual(fields);
  expect(()=>validateAnswers(fields,{},true)).toThrow("Site photo is required");
  expect(validateAnswers(fields,{},false)).toEqual({});
  for(const value of ["https://example.invalid/image",{},0,{evidenceId:-1},{evidenceId:1.5}]){
   expect(()=>validateAnswers(fields,{photo:value},true)).toThrow("Upload evidence");
  }
  expect(validateAnswers(fields,{photo:{evidenceId:1,actorId:999,fileName:"forged"}},true)).toEqual({photo:{evidenceId:1}});
 });
 it("seals bytes once, enforces scope/wording/tenant and blocks completion without required evidence",async()=>{
  const rollback=new Error("Rollback evidence fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:"Evidence "+randomUUID()}).returning();
   const [actor]=await tx.insert(usersTable).values({tenantId:tenant.id,name:"Actor",email:randomUUID()+"@example.invalid",role:"company_owner"}).returning();
   const [customer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:"Customer",email:"test@example.invalid",phone:"5550000000"}).returning();
   const [job]=await tx.insert(jobsTable).values({tenantId:tenant.id,customerId:customer.id,title:"Evidence job",scheduledAt:new Date(),assigneeId:actor.id}).returning();
   const [template]=await tx.insert(jobFormTemplatesTable).values({tenantId:tenant.id,name:"Evidence form",fields}).returning();
   const [form]=await tx.insert(jobFormsTable).values({tenantId:tenant.id,jobId:job.id,templateId:template.id,snapshot:{name:"Original wording",fields},required:true}).returning();
   const [upload]=await tx.insert(formEvidenceTable).values({tenantId:tenant.id,actorId:actor.id,scope:"job",scopeId:form.id,fieldId:"photo",label:fields[0].label,kind:"photo",uploadPath:"/objects/uploads/test",fileName:"photo.png",mimeType:"image/png"}).returning();
   await expect(resolveFormEvidence(tx,tenant.id,{scope:"job",scopeId:form.id},fields,{photo:{evidenceId:upload.id}})).rejects.toThrow("Upload valid evidence");
   const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
   const download=vi.fn(async()=>[bytes]);
   vi.spyOn(hrStorage,"getObjectEntityFile").mockResolvedValue({getMetadata:async()=>[{size:bytes.length}],download} as any);
   const save=vi.spyOn(hrStorage,"saveHrDocument").mockResolvedValue("/objects/hr-documents/sealed-test");
   const sealed=await finalizeEvidence(tenant.id,actor.id,upload.id,tx);
   expect(sealed).toMatchObject({actorId:actor.id,label:fields[0].label,sizeBytes:bytes.length,kind:"photo"});
   expect(sealed.sha256).toMatch(/^[a-f0-9]{64}$/);
   expect(await finalizeEvidence(tenant.id,actor.id,upload.id,tx)).toEqual(sealed);
   expect(save).toHaveBeenCalledTimes(1);
   const answers=await resolveFormEvidence(tx,tenant.id,{scope:"job",scopeId:form.id},fields,{photo:{evidenceId:upload.id,actorId:999}});
   expect(answers.photo).toEqual(sealed);
   await expect(resolveFormEvidence(tx,tenant.id+100000,{scope:"job",scopeId:form.id},fields,answers)).rejects.toThrow("Upload valid evidence");
   await expect(resolveFormEvidence(tx,tenant.id,{scope:"job",scopeId:form.id+1},fields,answers)).rejects.toThrow("Upload valid evidence");
   await expect(resolveFormEvidence(tx,tenant.id,{scope:"job",scopeId:form.id},[{...fields[0],label:"Changed wording"}],answers)).rejects.toThrow("Upload valid evidence");
   await expect(assertJobFormsComplete(tx,job)).rejects.toThrow("Complete required job forms");
   await tx.update(jobFormsTable).set({submittedAt:new Date(),submittedBy:actor.id,answers:{}}).where(eq(jobFormsTable.id,form.id));
   await expect(assertJobFormsComplete(tx,job)).rejects.toThrow("Site photo is required");
   await tx.update(jobFormsTable).set({answers}).where(eq(jobFormsTable.id,form.id));
   await expect(assertJobFormsComplete(tx,job)).resolves.toBeUndefined();
   vi.mocked(hrStorage.getObjectEntityFile).mockRejectedValue(new Error("Missing stored bytes"));
   await expect(assertJobFormsComplete(tx,job)).rejects.toThrow("Missing stored bytes");
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
 it("keeps HR record evidence private until explicitly shared and permits only the assigned employee on assignments",async()=>{
  const rollback=new Error("Rollback private HR fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:"Privacy "+randomUUID()}).returning();
   const users=await tx.insert(usersTable).values(["company_owner","office_manager","technician"].map((role,i)=>({tenantId:tenant.id,name:`Staff ${i}`,role,email:randomUUID()+"@example.invalid"}))).returning();
   const [owner,manager,employee]=users;
   const [template]=await tx.insert(employeeFormTemplatesTable).values({tenantId:tenant.id,name:"Personnel form",fields}).returning();
   const [evidence]=await tx.insert(formEvidenceTable).values({tenantId:tenant.id,actorId:owner.id,scope:"employee",scopeId:template.id,employeeId:employee.id,fieldId:"photo",label:fields[0].label,kind:"photo",uploadPath:"/objects/uploads/private",objectPath:"/objects/hr-documents/private",fileName:"photo.png",mimeType:"image/png",finalizedAt:new Date()}).returning();
   expect((await readableEvidence(tenant.id,owner.id,evidence.id,tx)).id).toBe(evidence.id);
   await expect(readableEvidence(tenant.id,manager.id,evidence.id,tx)).rejects.toThrow("HR-private");
   await expect(readableEvidence(tenant.id,employee.id,evidence.id,tx)).rejects.toThrow("HR-private");
   await tx.insert(employeeHistoryEntriesTable).values({tenantId:tenant.id,userId:employee.id,type:"custom_form",title:"Shared deliberately",createdById:owner.id,sharedWithEmployee:true,formData:{photo:{evidenceId:evidence.id}},formSnapshot:{fields}});
   expect((await readableEvidence(tenant.id,employee.id,evidence.id,tx)).id).toBe(evidence.id);
   await expect(readableEvidence(tenant.id,manager.id,evidence.id,tx)).rejects.toThrow("HR-private");
   const [assignment]=await tx.insert(employeeFormAssignmentsTable).values({tenantId:tenant.id,userId:employee.id,templateId:template.id,title:template.name,snapshot:{fields},assignedBy:owner.id}).returning();
   expect(await evidenceFields(tenant.id,employee.id,{scope:"assignment",scopeId:assignment.id},tx)).toEqual(fields);
   await expect(evidenceFields(tenant.id,manager.id,{scope:"assignment",scopeId:assignment.id},tx)).rejects.toThrow("private");
   await tx.update(employeeFormAssignmentsTable).set({submittedAt:new Date()}).where(eq(employeeFormAssignmentsTable.id,assignment.id));
   await expect(evidenceFields(tenant.id,employee.id,{scope:"assignment",scopeId:assignment.id},tx)).rejects.toThrow("preserved");
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
});
