import { describe,it,expect } from "vitest";
import { db,tenantsTable,usersTable,hrAccessTable,employeeHistoryEntriesTable,employeeFormTemplatesTable,timeEntriesTable,hrSettingsTable,hrApplicationsTable,taskNotificationsTable } from "@workspace/db";
import { eq,and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireHr,requireOwnerHr } from "./hrAccess";
import { createEmployeeRecord } from "./employeeRecords";
import { hiringSettings,intakeApplication } from "./hiring";
import { ObjectStorageService } from "./objectStorage";
describe("private employee records and hiring",()=>{
 it("cannot expose personnel files through generic downloads or signed URLs",async()=>{
  const storage=new ObjectStorageService();
  const file={name:"private/hr-documents/test-only",getMetadata:async()=>[{metadata:{hrPrivate:"true"}}]} as unknown as Parameters<ObjectStorageService["downloadObject"]>[0];
  await expect(storage.downloadObject(file)).rejects.toThrow("private personnel");
  expect(await storage.canAccessObjectEntity({objectFile:file,userId:"test-only"})).toBe(false);
  await expect(storage.generateSignedReadUrl("/objects/hr-documents/test-only")).rejects.toThrow("generic signed URLs");
 });
 it("requires explicit HR grants, rejects foreign evidence, and preserves wording and clock snapshots",async()=>{
  const rollback=new Error("Rollback private employee test fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:"HR check "+randomUUID()}).returning();
   const make=async(name:string,role:string)=> (await tx.insert(usersTable).values({tenantId:tenant.id,name,email:randomUUID()+"@example.invalid",role,isActive:true}).returning())[0];
   const owner=await make("Owner","company_owner"),manager=await make("Office","office_manager"),hr=await make("HR","technician"),worker=await make("Worker","technician");
   await expect(requireHr(tenant.id,manager.id,tx)).rejects.toThrow("designated HR");
   await expect(createEmployeeRecord(tenant.id,worker.id,worker.id,{type:"note",title:"Unauthorized"},tx)).rejects.toThrow("designated HR");
   await tx.insert(hrAccessTable).values({tenantId:tenant.id,userId:hr.id,grantedBy:owner.id});
   await requireHr(tenant.id,hr.id,tx);
   await expect(requireOwnerHr(tenant.id,hr.id,tx)).rejects.toThrow("Only the business owner");
   const [clock]=await tx.insert(timeEntriesTable).values({tenantId:tenant.id,userId:worker.id,clockedInAt:new Date("2026-10-01T14:00:00Z"),clockedOutAt:new Date("2026-10-01T14:30:00Z"),clockInLat:40,clockInLng:-105}).returning();
   const fields=[{id:"check",label:"Original review question",type:"yes_no",required:true}];
   const [template]=await tx.insert(employeeFormTemplatesTable).values({tenantId:tenant.id,name:"Review form",fields}).returning();
   await expect(createEmployeeRecord(tenant.id,owner.id,manager.id,{type:"yellow_card",title:"Wrong employee evidence",timeEntryIds:[clock.id]},tx)).rejects.toThrow("this employee");
   const entry=await createEmployeeRecord(tenant.id,hr.id,worker.id,{type:"yellow_card",title:"Recorded correction",occurredOn:"2026-10-01",formTemplateId:template.id,formData:{check:false},timeEntryIds:[clock.id]},tx);
   expect(entry.sharedWithEmployee).toBe(false);expect(entry.type).toBe("yellow_card");expect(entry.formData).toEqual({check:false});
   await tx.update(employeeFormTemplatesTable).set({fields:[{...fields[0],label:"New wording"}]}).where(eq(employeeFormTemplatesTable.id,template.id));
   await tx.update(timeEntriesTable).set({adjustedClockedInAt:new Date("2026-10-01T14:10:00Z")}).where(eq(timeEntriesTable.id,clock.id));
   const [saved]=await tx.select().from(employeeHistoryEntriesTable).where(eq(employeeHistoryEntriesTable.id,entry.id));
   expect((saved.formSnapshot as {fields:{label:string}[]}).fields[0].label).toBe("Original review question");
   expect((saved.evidence as {data:{adjustedClockedInAt:unknown;clockInLat:number}}[])[0].data.adjustedClockedInAt).toBe(null);
   expect((saved.evidence as {data:{clockInLat:number}}[])[0].data.clockInLat).toBe(40);
   await tx.update(usersTable).set({isActive:false}).where(eq(usersTable.id,hr.id));
   await expect(requireHr(tenant.id,hr.id,tx)).rejects.toThrow("designated HR");
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
 it("requires online consent, snapshots answers, deduplicates retries and only notifies owners and HR",async()=>{
  const rollback=new Error("Rollback hiring test fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:"Hiring check "+randomUUID()}).returning();
   const make=async(name:string,role:string)=> (await tx.insert(usersTable).values({tenantId:tenant.id,name,email:randomUUID()+"@example.invalid",role,isActive:true}).returning())[0];
   const owner=await make("Owner","company_owner"),hr=await make("HR","technician");await make("Office","office_manager");
   await tx.insert(hrAccessTable).values({tenantId:tenant.id,userId:hr.id,grantedBy:owner.id});
   await hiringSettings(tenant.id,tx);
   const input={requestId:randomUUID(),fullName:"QA Applicant",email:"applicant@example.invalid",phone:"5551234567",consent:true,answers:{check:false}};
   await expect(intakeApplication(tenant.id,null,input,"website",undefined,tx)).rejects.toThrow("not accepting");
   await tx.update(hrSettingsTable).set({publicHiringEnabled:true,applicationFields:[{id:"check",label:"Original availability question",type:"yes_no",required:true}]}).where(eq(hrSettingsTable.tenantId,tenant.id));
   await expect(intakeApplication(tenant.id,null,{...input,consent:false},"website",undefined,tx)).rejects.toThrow("Consent");
   const first=await intakeApplication(tenant.id,null,input,"website",undefined,tx);
   expect(first.answers).toEqual({check:false});expect(first.consentAt).not.toBe(null);expect(first.userId).toBe(null);
   const again=await intakeApplication(tenant.id,null,input,"website",undefined,tx);expect(again.id).toBe(first.id);
   await expect(intakeApplication(tenant.id,null,{...input,fullName:"Changed applicant"},"website",undefined,tx)).rejects.toThrow("details changed");
   await tx.update(hrSettingsTable).set({applicationFields:[{id:"check",label:"Changed wording",type:"yes_no",required:true}]}).where(eq(hrSettingsTable.tenantId,tenant.id));
   const [saved]=await tx.select().from(hrApplicationsTable).where(eq(hrApplicationsTable.id,first.id));
   expect((saved.fieldSnapshot as {label:string}[])[0].label).toBe("Original availability question");
   const notices=await tx.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.tenantId,tenant.id),eq(taskNotificationsTable.type,"hr_application")));
   expect(notices.map(n=>n.recipientUserId).sort()).toEqual([owner.id,hr.id].sort());expect(notices).toHaveLength(2);
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
});
