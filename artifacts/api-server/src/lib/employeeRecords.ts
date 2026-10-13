import { db,usersTable,employeeHistoryEntriesTable,employeeFormTemplatesTable,timeEntriesTable,subTimersTable } from "@workspace/db";
import { and,eq,inArray } from "drizzle-orm";
import { HrDb,HrError,requireHr,hrAudit,boundedText,calendarDate } from "./hrAccess";
import { validateFields,validateAnswers,FormField } from "./jobForms";
import { resolveFormEvidence } from "./formEvidence";
export function employeeFields(input:unknown):FormField[]{
 const fields=typeof input==="string"?JSON.parse(input):input;
 if(!Array.isArray(fields))throw new HrError("Invalid employee form questions");
 return validateFields(fields.map(f=>({...f,type:f.type==="checkbox"?"yes_no":f.type})));
}
export function employeeAnswers(fields:FormField[],input:unknown,submit:boolean){
 if(input!=null&&(typeof input!=="object"||Array.isArray(input)))throw new HrError("Employee form answers must be an object");
 const values={...(input as Record<string,unknown>??{})};
 for(const f of fields){
  if(f.type==="number"&&typeof values[f.id]==="string"&&values[f.id]!=="")values[f.id]=Number(values[f.id]);
  if(f.type==="yes_no"&&values[f.id]==="true")values[f.id]=true;
  if(f.type==="yes_no"&&values[f.id]==="false")values[f.id]=false;
 }
 return validateAnswers(fields,values,submit);
}
const selectedIds=(input:unknown)=>{
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>30||input.some(id=>!Number.isSafeInteger(id)||id<1))throw new HrError("Select valid employee evidence records");
 return [...new Set(input)] as number[];
};
export async function createEmployeeRecord(tenantId:number,actorId:number,userId:number,input:Record<string,unknown>,handle:HrDb=db){
 await requireHr(tenantId,actorId,handle);
 return handle.transaction(async tx=>{
  const [employee]=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,userId)));
  if(!employee)throw new HrError("Employee not found",404);
  const type=String(input.type);
  if(!["review","complaint","callback","custom_form","yellow_card","correction","incident","note"].includes(type))throw new HrError("Choose a valid personnel record type");
  let formSnapshot:unknown=null,formTemplateId:number|null=null,formData:Record<string,unknown>={};
  if(type==="custom_form"||input.formTemplateId){
   formTemplateId=Number(input.formTemplateId);
   const [template]=await tx.select().from(employeeFormTemplatesTable).where(and(eq(employeeFormTemplatesTable.tenantId,tenantId),eq(employeeFormTemplatesTable.id,formTemplateId),eq(employeeFormTemplatesTable.isActive,"true")));
   if(!template)throw new HrError("Active employee form template not found",404);
   const fields=employeeFields(template.fields);formData=employeeAnswers(fields,input.formData,true);
   await resolveFormEvidence(tx,tenantId,{scope:"employee",scopeId:template.id,employeeId:userId},fields,formData);
   formSnapshot={name:template.name,description:template.description,fields};
  }
  const timeIds=selectedIds(input.timeEntryIds),timerIds=selectedIds(input.subTimerIds);
  const clocks=timeIds.length?await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId,tenantId),eq(timeEntriesTable.userId,userId),inArray(timeEntriesTable.id,timeIds))):[];
  const timers=timerIds.length?await tx.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),inArray(subTimersTable.id,timerIds))):[];
  if(clocks.length!==timeIds.length||timers.length!==timerIds.length)throw new HrError("Evidence must belong to this employee and business");
  const [created]=await tx.insert(employeeHistoryEntriesTable).values({tenantId,userId,type,title:boundedText(input.title,"Record title",200,true),
   notes:boundedText(input.notes,"Notes",20000),occurredOn:calendarDate(input.occurredOn),createdById:actorId,sharedWithEmployee:input.sharedWithEmployee===true,
   formTemplateId,formData,formSnapshot,evidence:[...clocks.map(entry=>({kind:"time_entry",id:entry.id,capturedAt:new Date().toISOString(),data:entry})),
    ...timers.map(entry=>({kind:"sub_timer",id:entry.id,capturedAt:new Date().toISOString(),data:entry}))]}).returning();
  await hrAudit(tx,tenantId,actorId,"personnel_record_added",userId,null,null,created);
  return created;
 });
}
