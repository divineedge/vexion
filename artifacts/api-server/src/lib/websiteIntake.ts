import {db,tenantsTable,hrSettingsTable,hrPostingsTable,servicesTable,websiteIntakeSubmissionsTable,customersTable,propertiesTable,estimatesTable,usersTable,taskNotificationsTable,hrDocumentsTable} from '@workspace/db';
import {hrFile,hrStorage} from './hrFiles';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {acquisitionSettings} from './acquisitionRewards';
import {intakeApplication} from './hiring';
import {HrError,type HrDb} from './hrAccess';
import {effectivePaymentPolicy} from './paymentPolicy';
import {logger} from './logger';
import {APPROXIMATE_SIZE_TERMS} from '@workspace/api-client-react/website-flow';
import {getWebsiteForm,canonicalJson,validateWebsiteAnswers,validateMeasurements,calculateWebsitePreview,type FlowKind,type FlowDefinition,type Answers,type Measurements,type PricePreview} from './websiteFlow';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {websiteCustomerChoices} from './websiteCustomerChoices';
const kindSchema=z.enum(['quote','hiring']);
export const publicInput=z.object({tenantId:z.number().int().positive(),kind:kindSchema,requestId:z.string().uuid(),revision:z.number().int().nonnegative(),answers:z.record(z.string(),z.unknown()),measurements:z.record(z.string(),z.unknown()).default({}),consent:z.literal(true),referralCode:z.string().max(200).optional(),doorHangerCode:z.string().max(200).optional()}).strict();
export const definitionVersion=(flow:FlowDefinition)=>parseInt(createHash('sha256').update(canonicalJson(flow)).digest('hex').slice(0,8),16);
export async function publicWebsiteConfig(kind:FlowKind,tenantId?:number,slug?:string,handle:HrDb=db){
 const [tenant]=await handle.select().from(tenantsTable).where(tenantId?eq(tenantsTable.id,tenantId):eq(tenantsTable.slug,slug??''));
 if(!tenant)throw new HrError('Business not found',404);
 const [hr]=await handle.select().from(hrSettingsTable).where(eq(hrSettingsTable.tenantId,tenant.id));
 const enabled=kind==='quote'?acquisitionSettings(tenant.acquisitionSettings).quoteWidgetEnabled:hr?.publicHiringEnabled===true;
 if(!enabled)throw new HrError(kind==='quote'?'Website quotes are not enabled':'This business is not accepting applications',404);
 const form=await getWebsiteForm(tenant.id,kind,handle);
  // Existing enabled links retain their legacy form until staff explicitly publish.
  // Saving a private first draft must never make that draft public.
  const definition=structuredClone(form.published??(await getWebsiteForm(tenant.id,kind,handle,true)).definition);
 for(const step of definition.steps)if(step.allowApproximate&&!step.approximateTerms)step.approximateTerms=APPROXIMATE_SIZE_TERMS;
 let services=kind==='quote'?await handle.select({id:servicesTable.id,name:servicesTable.name}).from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.isActive,true))):[];
 const choices=definition.steps.flatMap(s=>s.questions).find(q=>q.id==='serviceIds')?.options??[];
 if(choices.length)services=services.filter(s=>choices.includes(String(s.id)));
 const postings=kind==='hiring'?await handle.select({id:hrPostingsTable.id,title:hrPostingsTable.title}).from(hrPostingsTable).where(and(eq(hrPostingsTable.tenantId,tenant.id),eq(hrPostingsTable.status,'open'))):[];
 return {tenantId:tenant.id,companyName:tenant.name,enabled:true,definition,revision:definitionVersion(definition),services,postings,privacyNotice:definition.privacyNotice};
}
const receipt=(row:typeof websiteIntakeSubmissionsTable.$inferSelect)=>({received:true as const,pendingReview:true as const,reference:row.reference,preview:row.preview as PricePreview|null});
export async function receiveWebsiteSubmission(raw:unknown,resume?:Express.Multer.File,files:Express.Multer.File[]=[]){
 const parsed=publicInput.safeParse(raw);if(!parsed.success)throw new HrError('Provide valid submission details and consent to storage and contact');
 const input=parsed.data;
 if(resume&&input.kind!=='hiring')throw new HrError('Resume files are only accepted with hiring applications');
 if(files.length>5||[...files,...(resume?[resume]:[])].reduce((n,f)=>n+f.size,0)>25*1024*1024)throw new HrError('Upload at most five attachments, 10 MB each, and 25 MB total including the resume',413);
 const fileInfo=files.map(file=>{const info=hrFile(file);if(!['application/pdf','image/jpeg'].includes(info.mimeType))throw new HrError('Attachments must be JPEG images or PDF documents');if(file.size>10*1024*1024)throw new HrError('Each attachment must be at most 10 MB',413);return {file,info};});
 const hash=createHash('sha256').update(canonicalJson({input,resume:resume?{name:resume.originalname,hash:createHash('sha256').update(resume.buffer).digest('hex')}:null,...(files.length?{files:files.map(f=>({name:f.originalname,hash:createHash('sha256').update(f.buffer).digest('hex')}))}:{})})).digest('hex');
 const stored:string[]=[];
 try{return await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('website-intake'),hashtext(${input.tenantId+':'+input.kind+':'+input.requestId}))`);
  const [prior]=await tx.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,input.tenantId),eq(websiteIntakeSubmissionsTable.kind,input.kind),eq(websiteIntakeSubmissionsTable.requestId,input.requestId)));
  if(prior){if(prior.requestHash!==hash)throw new HrError('Submission details changed. Start a new submission.',409);return receipt(prior);}
  // Configuration is re-read inside the lock. Published revisions never depend on draft saves.
  const config=await publicWebsiteConfig(input.kind,input.tenantId,undefined,tx);
  if(input.revision!==config.revision)throw new HrError('This form has changed. Refresh the page before submitting.',409);
  const visible=validateWebsiteAnswers(config.definition,input.answers);
  const selected=Array.isArray(visible.answers.serviceIds)?visible.answers.serviceIds:visible.answers.serviceIds?[visible.answers.serviceIds]:[];
  if(input.kind==='quote'&&selected.some(id=>!config.services.some(s=>String(s.id)===String(id))))throw new HrError('Choose one of the offered services');
  if(files.length&&!config.definition.uploads?.enabled)throw new HrError('File attachments are not enabled for this form');
  if(config.definition.uploads?.enabled&&config.definition.uploads.required&&!files.length)throw new HrError('Add the required JPEG or PDF attachment');
  const measured=validateMeasurements(config.definition,visible.answers,input.measurements);
  const preview=input.kind==='quote'?await calculateWebsitePreview(input.tenantId,visible.answers,measured.areaSqft,measured.lengthFt,tx):null;
  let applicationId:number|null=null;
  if(input.kind==='hiring'){
   const postingId=visible.answers.postingId;
   if(postingId&&!config.postings.some(p=>String(p.id)===String(postingId)))throw new HrError('This position is no longer open');
   const application=await intakeApplication(input.tenantId,null,{requestId:input.requestId,fullName:visible.answers.name??'',email:visible.answers.email??'',phone:visible.answers.phone??'',postingId:postingId??null,answers:visible.answers,consent:true},'website',undefined,tx,config.definition);
   applicationId=application.id;
  }
  const attachments=[];
  const uploads=[...(resume?[{file:resume,info:hrFile(resume),role:'resume'}]:[]),...fileInfo.map(f=>({...f,role:'attachment'}))];
  for(const upload of uploads){
   const objectPath=await hrStorage.saveHrDocument(upload.file.buffer,upload.info.mimeType);stored.push(objectPath);
   if(applicationId)await tx.insert(hrDocumentsTable).values({tenantId:input.tenantId,applicationId,title:upload.role==='resume'?'Application resume':config.definition.uploads?.label??'Website attachment',...upload.info,objectPath,uploadedBy:null});
   attachments.push({id:randomUUID(),...upload.info,role:upload.role,objectPath});
  }
  const [row]=await tx.insert(websiteIntakeSubmissionsTable).values({tenantId:input.tenantId,kind:input.kind,requestId:input.requestId,requestHash:hash,reference:randomUUID(),applicationId,
   payload:{answers:visible.answers,measurements:measured.measurements,areaSqft:measured.areaSqft,lengthFt:measured.lengthFt,referralCode:input.referralCode,doorHangerCode:input.doorHangerCode,consentAt:new Date().toISOString(),revision:input.revision,attachments},
   snapshot:config.definition,preview,path:visible.steps.map(s=>s.id)}).returning();
  if(input.kind==='quote'){
   // No PII in notifications and no customer/property/estimate creation at public submission.
   await tx.execute(sql`INSERT INTO task_notifications(tenant_id,recipient_user_id,type,message,link_path)
    SELECT ${input.tenantId},id,'website_quote','A website estimate inquiry is awaiting review.','/website-forms?kind=quote' FROM users
    WHERE tenant_id=${input.tenantId} AND is_active IS DISTINCT FROM false AND role IN ('company_owner','office_manager','department_manager')`);
  }
  return receipt(row);
 });}catch(error){
  if(stored.length){
   // A disconnected COMMIT can be ambiguous. Never delete evidence for a saved receipt.
   try{
    const [committed]=await db.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,input.tenantId),eq(websiteIntakeSubmissionsTable.kind,input.kind),eq(websiteIntakeSubmissionsTable.requestId,input.requestId)));
    if(committed?.requestHash===hash)return receipt(committed);
    const cleanup=await Promise.allSettled(stored.map(path=>hrStorage.deleteObjectEntity(path)));
    if(cleanup.some(r=>r.status==='rejected'))logger.warn('Private website attachment cleanup requires attention');
   }catch{logger.warn('Could not verify website attachment commit; retaining private files to avoid evidence loss');}
  }
  throw error;
 }
}
export function staffSubmission(row:typeof websiteIntakeSubmissionsTable.$inferSelect){
 const {requestHash:_hash,requestId:_request,...safe}=row;
 const payload=row.payload as Record<string,unknown>;
 const files=(payload.attachments??[]) as Record<string,unknown>[];
 return {...safe,payload:{...payload,attachments:files.map(({objectPath:_private,...file})=>file)}};
}
export const reviewInput=z.object({action:z.enum(['approve','decline','review']),notes:z.string().max(20000).optional(),
 customerId:z.number().int().positive().optional(),propertyId:z.number().int().positive().optional(),confirmCustomerChoice:z.boolean().optional(),
 customer:z.object({name:z.string().trim().max(200),email:z.string().max(254).optional(),phone:z.string().max(80).optional(),address:z.string().max(500).optional(),city:z.string().max(200).optional(),state:z.string().max(100).optional(),zip:z.string().max(50).optional()}).strict().optional(),
 createEstimate:z.boolean().optional(),areaSqft:z.number().finite().positive().max(10000000).optional(),lengthFt:z.number().finite().positive().max(100000).optional()}).strict();
export async function reviewWebsiteSubmission(tenantId:number,userId:number,id:number,input:z.infer<typeof reviewInput>,handle:HrDb=db){
 return handle.transaction(async tx=>{
  const [row]=await tx.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,tenantId),eq(websiteIntakeSubmissionsTable.id,id))).for('update');
  if(!row)throw new HrError('Submission not found',404);
  if(row.status!=='pending')return row; // serialized, retry-safe decision; never creates duplicates
  if(row.kind==='hiring'&&input.action==='approve')throw new HrError('Review the application in Hiring; hiring decisions never create a customer');
  const payload=row.payload as {answers:Answers;measurements:Measurements;areaSqft:number|null;lengthFt:number|null;referralCode?:string;doorHangerCode?:string};
  let customerId:number|null=null,propertyId:number|null=null,estimateId:number|null=null;
  const status=input.action==='approve'?'approved':input.action==='decline'?'declined':'reviewed';
  if(input.action==='approve'){
   const a=payload.answers;
   const c={name:String(a.name??''),email:String(a.email??''),phone:String(a.phone??''),address:String(a.address??''),city:String(a.city??''),state:String(a.state??''),zip:String(a.zip??''),...input.customer};
   if(!c.name.trim())c.name=String(a.name??'');
   c.email=c.email?.trim();
   if(input.propertyId&&!input.customerId)throw new HrError('Select the customer who owns this property');
   if(input.customerId&&input.customer)throw new HrError('Linking an existing customer cannot change their contact details');
   if(input.customerId){
    if(!input.confirmCustomerChoice)throw new HrError('Confirm the existing customer and property choice');
    const [existing]=await tx.select({id:customersTable.id}).from(customersTable).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,input.customerId),isNull(customersTable.archivedAt))).for('update');
    if(!existing)throw new HrError('Selected customer is unavailable',404);
    customerId=existing.id;
    if(input.propertyId){
     const [property]=await tx.select({id:propertiesTable.id}).from(propertiesTable).where(and(eq(propertiesTable.tenantId,tenantId),eq(propertiesTable.customerId,customerId),eq(propertiesTable.id,input.propertyId),isNull(propertiesTable.archivedAt))).for('update');
     if(!property)throw new HrError('Selected property is unavailable for this customer',404);
     propertyId=property.id;
    }
   }else{
    const choices=await websiteCustomerChoices(tenantId,id,'',tx,c);
    if(choices.possibleMatches.length&&!input.confirmCustomerChoice)throw new HrError('Possible existing customers found. Confirm that a new customer is intended.',409);
   }
   if(!customerId&&!c.name.trim())throw new HrError('Enter the customer name before creating a CRM record');
   if(!customerId&&c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw new HrError('Enter a valid email or leave it blank');
   const [tenant]=await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
   if(!customerId){
   const policy=acquisitionSettings(tenant.acquisitionSettings);
   let referrer:number|null=null,employee:number|null=null,visitId:number|null=null;
   if(payload.referralCode){
    const [ref]=await tx.select().from(customersTable).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.referralShareToken,payload.referralCode)));
    if(ref&&policy.customerReferralsEnabled&&(!c.email||ref.email.toLowerCase()!==c.email.toLowerCase()))referrer=ref.id;
   }
   if(payload.doorHangerCode){
    const visits=await tx.execute(sql`SELECT id,employee_id FROM door_hanger_visits WHERE tenant_id=${tenantId} AND share_token=${payload.doorHangerCode} AND converted_customer_id IS NULL FOR UPDATE`);
    if(visits.rows[0]){visitId=Number(visits.rows[0].id);employee=Number(visits.rows[0].employee_id);}
   }
   const customFieldValues:Record<string,unknown>={};
   for(const field of (tenant.customFields as {customerFields?:{key:string}[]}|null)?.customerFields??[]){
    if(['__proto__','constructor','prototype'].includes(field.key))continue;
    const key='custom_'+String(field.key).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,40);
    if(Object.hasOwn(a,key))customFieldValues[field.key]=a[key];
   }
   const [customer]=await tx.insert(customersTable).values({tenantId,name:c.name.trim(),email:c.email?.trim().toLowerCase()??'',phone:c.phone?.trim()??'',physicalAddress:c.address??'',physicalCity:c.city??'',physicalState:c.state??'',physicalZip:c.zip??'',
    smsOptOut:true,emailOptOut:true,referralSource:referrer?'customer_referral':visitId?'door_hanger':'website_quote',referringCustomerId:referrer,acquiredByEmployeeId:employee,doorHangerVisitId:visitId,customFieldValues}).returning();
   customerId=customer.id;
   await tx.execute(sql`UPDATE customers SET acquisition_reward_snapshot=${JSON.stringify({...policy,assignedAt:new Date().toISOString()})}::jsonb WHERE id=${customerId}`);
   if(visitId)await tx.execute(sql`UPDATE door_hanger_visits SET converted_customer_id=${customerId} WHERE id=${visitId}`);
   }
   const area=input.areaSqft??payload.areaSqft,length=input.lengthFt??payload.lengthFt;
   const preview=row.preview&&input.areaSqft==null&&input.lengthFt==null?row.preview as PricePreview:await calculateWebsitePreview(tenantId,a,area,length,tx);
   if(!propertyId&&c.address?.trim()){
    const points=typeof a.lat==='number'&&typeof a.lng==='number'&&a.pinConfirmed===true?{lat:a.lat,lng:a.lng}:{lat:null,lng:null};
    const zones=Object.entries(payload.measurements).map(([key,m])=>({id:randomUUID(),label:`Customer measurement: ${key}`,vertices:m.points.map(p=>[p.lat,p.lng]),mode:m.mode,areaSqft:m.mode==='area'?area:0,lengthFt:m.mode==='linear'?length:null,enabled:true,color:'#22c55e'}));
    const [property]=await tx.insert(propertiesTable).values({tenantId,customerId,address:c.address,city:c.city??'',state:c.state??'',zip:c.zip??'',...points,size:area,sizeUnit:'sqft',measurementPolygons:zones}).returning();propertyId=property.id;
   }
   if(input.createEstimate){
    if(!preview)throw new HrError('Record a measurement and configure service pricing before generating the estimate');
    const lineItems=preview.items.map(i=>({id:randomUUID(),serviceId:i.serviceId,propertyId,description:i.name,qty:1,unitPrice:i.price,markup:0,discount:0,isOptional:false,total:i.price}));
    const {policy}=await effectivePaymentPolicy(tx,tenantId,customerId,null,{total:preview.total,serviceIds:preview.items.map(i=>i.serviceId)});
    const paymentRequirement=policy.requirePrepay||policy.depositType==='full'?'full':policy.depositType==='fixed'?'deposit_fixed':policy.depositType==='percent'?'deposit_pct':'none';
    const [estimate]=await tx.insert(estimatesTable).values({tenantId,customerId,propertyId,status:'draft',subtotal:preview.total,total:preview.total,tax:0,lineItems,
     paymentRequirement,depositValue:policy.depositType==='fixed'||policy.depositType==='percent'?policy.depositValue:null,
     expiresAt:new Date(Date.now()+30*86400000),termsText:tenant.defaultEstimateTerms,notes:tenant.defaultEstimateNotes||'Prepared after staff review of a website submission. Customer-provided measurements must be verified.'}).returning();
    estimateId=estimate.id;
   }
  }
  const reviewData={...input,customerChoice:customerId?(input.customerId?'existing':'created'):null,propertyChoice:propertyId?(input.propertyId?'existing':'created'):null};
  await tx.execute(sql`UPDATE website_intake_submissions SET status=${status},customer_id=${customerId},property_id=${propertyId},estimate_id=${estimateId},review_notes=${input.notes??''},reviewed_by=${userId},reviewed_at=now(),review_data=${JSON.stringify(reviewData)}::jsonb WHERE id=${id} AND tenant_id=${tenantId}`);
  const [saved]=await tx.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.id,id));return saved;
 });
}
