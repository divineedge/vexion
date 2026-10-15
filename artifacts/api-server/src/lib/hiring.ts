import { db,tenantsTable,hrSettingsTable,hrPostingsTable,hrApplicationsTable,hrDocumentsTable } from "@workspace/db";
import { and,eq,sql } from "drizzle-orm";
import { randomUUID,createHash } from "node:crypto";
import { HrError,HrDb,boundedText,hrAudit } from "./hrAccess";
import { validateFields,validateAnswers } from "./jobForms";
import { hrStorage,hrFile } from "./hrFiles";
import {validateWebsiteAnswers,type FlowDefinition} from './websiteFlow';
export async function hiringSettings(tenantId:number,handle:HrDb=db){
 await handle.insert(hrSettingsTable).values({tenantId}).onConflictDoNothing();
 const [settings]=await handle.select().from(hrSettingsTable).where(eq(hrSettingsTable.tenantId,tenantId));return settings;
}
export function hiringFields(value:unknown){
 if(Array.isArray(value)&&value.length===0)return [];
 return validateFields(value);
}
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stable(v)])):value;
export async function intakeApplication(tenantId:number,actorId:number|null,input:Record<string,unknown>,source:"staff"|"website",resume?:Express.Multer.File,handle:HrDb=db,websiteFlow?:FlowDefinition){
 const requestId=typeof input.requestId==="string"?input.requestId:randomUUID();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))throw new HrError("A valid application reference is required");
 const {requestId:_,...payload}=input;
 const payloadHash=createHash("sha256").update(JSON.stringify(stable({payload,source,resume:resume?{name:resume.originalname,hash:createHash("sha256").update(resume.buffer).digest("hex")}:null}))).digest("hex");
 let newlyStored:string|null=null;
 try{return await handle.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('hiring-intake'),hashtext(${tenantId+":"+requestId}))`);
  const [existing]=await tx.select().from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.requestId,requestId)));
  if(existing){if(existing.payloadHash!==payloadHash)throw new HrError("Application details changed. Use a new submission reference.",409);return existing;}
  const settings=await hiringSettings(tenantId,tx);
  if(source==="website"&&(!settings.publicHiringEnabled||input.consent!==true))throw new HrError(settings.publicHiringEnabled?"Consent to application storage and hiring contact is required":"This business is not accepting online applications",403);
  const postingId=input.postingId==null||input.postingId===""?null:Number(input.postingId);
  if(postingId!==null&&(!Number.isSafeInteger(postingId)||postingId<1))throw new HrError("Choose a valid position");
  const [posting]=postingId?await tx.select().from(hrPostingsTable).where(and(eq(hrPostingsTable.tenantId,tenantId),eq(hrPostingsTable.id,postingId))):[];
  if(postingId&&(!posting||(source==="website"&&posting.status!=="open")))throw new HrError("This position is not accepting applications",400);
   const visible=websiteFlow?validateWebsiteAnswers(websiteFlow,input.answers??{}):null;
   const fields=visible?visible.steps.flatMap(s=>s.questions):hiringFields(Array.isArray(posting?.fields)&&posting.fields.length?posting.fields:settings.applicationFields);
   const answers=visible?visible.answers:fields.length?validateAnswers(fields as Parameters<typeof validateAnswers>[0],input.answers??{},true):{};
   const fullName=boundedText(input.fullName,"Full name",200,!websiteFlow),email=boundedText(input.email,"Email",254,!websiteFlow).toLowerCase(),phone=boundedText(input.phone,"Phone",80,!websiteFlow);
   if((email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||(phone&&(phone.replace(/\D/g,"").length<7||phone.replace(/\D/g,"").length>25)))throw new HrError("Enter a valid email and phone number");
  const [application]=await tx.insert(hrApplicationsTable).values({tenantId,postingId,requestId,payloadHash,fullName,email,phone,source,answers,fieldSnapshot:fields,
    notes:source==="staff"?boundedText(input.notes,"Notes",20000):null,consentAt:source==="website"?new Date():null,consentSnapshot:source==="website"?(websiteFlow?.privacyNotice??settings.privacyNotice):null}).returning();
  if(resume){
   const info=hrFile(resume);newlyStored=await hrStorage.saveHrDocument(resume.buffer,info.mimeType);
   await tx.insert(hrDocumentsTable).values({tenantId,applicationId:application.id,title:"Application resume",...info,objectPath:newlyStored,uploadedBy:actorId});
  }
  await hrAudit(tx,tenantId,actorId,"application_received",null,application.id,null,{source,postingId});
  // Notifications contain no applicant details; the linked hiring page checks current HR access.
  await tx.execute(sql`INSERT INTO task_notifications(tenant_id,recipient_user_id,type,message,link_path)
    SELECT ${tenantId},u.id,'hr_application','A hiring application was received. Review it in Hiring.','/hiring'
    FROM users u WHERE u.tenant_id=${tenantId} AND u.is_active IS DISTINCT FROM false
    AND (u.role='company_owner' OR EXISTS(SELECT 1 FROM hr_access h WHERE h.tenant_id=${tenantId} AND h.user_id=u.id))`);
  return application;
 });}catch(error){if(newlyStored)await hrStorage.deleteObjectEntity(newlyStored).catch(()=>{});throw error;}
}
export async function companyCareers(slug:string){
 const [tenant]=await db.select({id:tenantsTable.id,name:tenantsTable.name}).from(tenantsTable).where(eq(tenantsTable.slug,slug));
 if(!tenant)throw new HrError("Business careers page not found",404);
 return tenant;
}
