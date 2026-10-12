import { describe,it,expect } from "vitest";
import { db,tenantsTable,usersTable,customersTable,jobsTable,visitsTable,timeEntriesTable,jobFormTemplatesTable,jobFormsTable,invoicesTable } from "@workspace/db";
import { and,eq } from "drizzle-orm";
import { formsGuardedJobUpdate,ensureJobForms,validateAnswers } from "./jobForms";
import { startVisitClock,stopVisitClock } from "./visitClock";
import { creditedInvoiceInsert } from "./customerCredit";
import { randomUUID } from "node:crypto";
describe("forms, visits and manual invoice coverage",()=>{
 it("blocks every completion until the required snapshot is submitted, starts the day clock, and claims manually invoiced jobs",async()=>{
  const rollback=new Error("Rollback isolated workflow fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:"Workflow test "+randomUUID()}).returning();
   const [user]=await tx.insert(usersTable).values({tenantId:tenant.id,name:"Worker",email:randomUUID()+"@example.invalid",role:"technician"}).returning();
   const [customer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:"Test customer",email:"customer@example.invalid",phone:"5550000000"}).returning();
   const [job]=await tx.insert(jobsTable).values({tenantId:tenant.id,customerId:customer.id,title:"Test job",scheduledAt:new Date(),assigneeId:user.id,totalAmount:100}).returning();
   const fields=[{id:"check",label:"Site check",type:"yes_no" as const,required:true}];
   const [template]=await tx.insert(jobFormTemplatesTable).values({tenantId:tenant.id,name:"Required check",fields,required:true,assignment:"all_jobs"}).returning();
   await ensureJobForms(tx,job);
   await expect(formsGuardedJobUpdate(tx).set({status:"completed"}).where(eq(jobsTable.id,job.id)).returning()).rejects.toThrow("Required check");
   const [form]=await tx.select().from(jobFormsTable).where(eq(jobFormsTable.jobId,job.id));
   expect(()=>validateAnswers(fields,{},true)).toThrow("Site check");
   expect(validateAnswers(fields,{check:false},true)).toEqual({check:false});
   await tx.update(jobFormsTable).set({answers:{check:false},submittedAt:new Date(),submittedBy:user.id}).where(eq(jobFormsTable.id,form.id));
   await tx.update(jobFormTemplatesTable).set({name:"Changed template",fields:[{id:"new",label:"Changed",type:"text",required:true}]}).where(eq(jobFormTemplatesTable.id,template.id));
   const [completed]=await formsGuardedJobUpdate(tx).set({status:"completed"}).where(eq(jobsTable.id,job.id)).returning();
   expect(completed.status).toBe("completed");
   const [historical]=await tx.select().from(jobFormsTable).where(eq(jobFormsTable.id,form.id));
   expect(historical.snapshot).toMatchObject({name:"Required check",fields});
   const [visit]=await tx.insert(visitsTable).values({tenantId:tenant.id,customerId:customer.id,assigneeId:user.id,purpose:"Measure property",scheduledAt:new Date()}).returning();
   const clock=await startVisitClock(tenant.id,user.id,visit.id,tx);
   expect(clock.active).toBe(true);
   expect((await startVisitClock(tenant.id,user.id,visit.id,tx)).entryId).toBe(clock.entryId);
   expect((await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId,tenant.id),eq(timeEntriesTable.isMasterClock,true)))).length).toBe(1);
   expect((await stopVisitClock(tenant.id,user.id,visit.id,tx)).active).toBe(false);
   const [invoice]=await creditedInvoiceInsert(tx,true).values({tenantId:tenant.id,customerId:customer.id,jobId:job.id,invoiceNumber:"MANUAL-TEST",total:100,subtotal:100}).returning();
   const [claimed]=await tx.select().from(jobsTable).where(eq(jobsTable.id,job.id));expect(claimed.invoiceId).toBe(invoice.id);
   await expect(creditedInvoiceInsert(tx,true).values({tenantId:tenant.id,customerId:customer.id,jobId:job.id,invoiceNumber:"AUTO-TEST",total:100,subtotal:100}).returning()).rejects.toThrow("already invoiced");
   expect((await tx.select().from(invoicesTable).where(eq(invoicesTable.tenantId,tenant.id))).length).toBe(1);
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
});
