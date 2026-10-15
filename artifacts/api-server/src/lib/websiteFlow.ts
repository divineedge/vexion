import {z} from 'zod';
import {db,hrSettingsTable,servicesTable,hrPostingsTable,tenantsTable} from '@workspace/db';
import {and,eq,sql} from 'drizzle-orm';
import {defaultWebsiteFlow,visibleFlow,validateFlowAnswers,type FlowKind,type FlowDefinition,type FlowQuestion,type Answers,type Measurements,type PricePreview} from '@workspace/api-client-react/website-flow';
import {HrError,type HrDb} from './hrAccess';
import {resolveServicePrice,type PricingTier} from './pricingMatrix';
export {defaultWebsiteFlow,visibleFlow,validateFlowAnswers};
export type {FlowKind,FlowDefinition,Answers,Measurements,PricePreview};
const id=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const condition=z.object({field:id,operator:z.enum(['equals','not_equals','contains','answered']),value:z.string().max(10000)}).strict().nullable().optional();
const question=z.object({id,label:z.string().trim().min(1).max(300),type:z.enum(['text','textarea','email','phone','number','date','select','multiselect','checkbox']),required:z.boolean(),options:z.array(z.string().min(1).max(300)).max(100),condition}).strict();
export const websiteFlowSchema=z.object({title:z.string().trim().min(1).max(300),intro:z.string().max(10000),privacyNotice:z.string().trim().min(1).max(10000),successMessage:z.string().trim().min(1).max(3000),
 uploads:z.object({enabled:z.boolean(),required:z.boolean(),label:z.string().trim().min(1).max(300)}).strict().optional(),
 steps:z.array(z.object({id,title:z.string().trim().min(1).max(300),kind:z.enum(['questions','property','measurement']),required:z.boolean(),measurementMode:z.enum(['area','linear']),allowPinMove:z.boolean(),allowApproximate:z.boolean().optional(),approximateTerms:z.string().trim().min(1).max(10000).optional(),condition,questions:z.array(question).max(50)}).strict()).min(1).max(30)}).strict().superRefine((flow,ctx)=>{
 const fields=new Set<string>(),steps=new Set<string>();
 const check=(c:z.infer<typeof condition>)=>{if(c&&!fields.has(c.field))ctx.addIssue({code:'custom',message:'Conditions must refer to an earlier question; reorder steps or update the condition'});};
 for(const step of flow.steps){
  if(steps.has(step.id))ctx.addIssue({code:'custom',message:'Step IDs must be unique'});steps.add(step.id);check(step.condition);
  for(const q of step.questions){
   if(q.id==='serviceIds'&&(!['select','multiselect'].includes(q.type)||q.options.some(v=>!/^[1-9]\d*$/.test(v))))ctx.addIssue({code:'custom',message:'The services picker must use single or multiple selection of catalog services'});
   check(q.condition);
   if(fields.has(q.id)||['__proto__','constructor','prototype','lat','lng','pinConfirmed'].includes(q.id))ctx.addIssue({code:'custom',message:'Question IDs must be unique and cannot use reserved names'});
   fields.add(q.id);
  }
 }
 if(flow.steps.reduce((n,s)=>n+s.questions.length,0)>150)ctx.addIssue({code:'custom',message:'Use at most 150 questions'});
 if(flow.steps.filter(s=>s.kind==='property').length>1)ctx.addIssue({code:'custom',message:'Use one property pin confirmation step'});
});
export async function installWebsiteIntakeSchema(){
 await db.execute(sql`CREATE TABLE IF NOT EXISTS website_intake_forms(tenant_id integer NOT NULL REFERENCES tenants(id),kind text NOT NULL,draft jsonb NOT NULL,published jsonb,revision integer NOT NULL DEFAULT 0,updated_by integer REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,kind))`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS website_intake_versions(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),kind text NOT NULL,revision integer NOT NULL,definition jsonb NOT NULL,published_by integer,publisher_name text,published_at timestamptz,legacy integer NOT NULL DEFAULT 0)`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS website_intake_version_revision ON website_intake_versions(tenant_id,kind,revision)`);
 // Earlier releases retained only the current live form, not its publication metadata.
 await db.execute(sql`INSERT INTO website_intake_versions(tenant_id,kind,revision,definition,legacy)
   SELECT f.tenant_id,f.kind,f.revision,f.published,1 FROM website_intake_forms f
   WHERE f.published IS NOT NULL AND NOT EXISTS(SELECT 1 FROM website_intake_versions v WHERE v.tenant_id=f.tenant_id AND v.kind=f.kind)
   ON CONFLICT DO NOTHING`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS website_intake_submissions(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),kind text NOT NULL,request_id text NOT NULL,request_hash text NOT NULL,reference text NOT NULL,status text NOT NULL DEFAULT 'pending',payload jsonb NOT NULL,snapshot jsonb NOT NULL,preview jsonb,path jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),customer_id integer,property_id integer,estimate_id integer,application_id integer,review_notes text,reviewed_by integer,reviewed_at timestamptz,review_data jsonb)`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS website_intake_once ON website_intake_submissions(tenant_id,kind,request_id)`);
 await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS website_intake_reference ON website_intake_submissions(reference)`);
 await db.execute(sql`CREATE INDEX IF NOT EXISTS website_intake_inbox ON website_intake_submissions(tenant_id,kind,id)`);
}
export async function getWebsiteForm(tenantId:number,kind:FlowKind,handle:HrDb=db,legacyOnly=false){
 const result=await handle.execute(sql`SELECT draft,published,revision FROM website_intake_forms WHERE tenant_id=${tenantId} AND kind=${kind}`);
 const row=result.rows[0];
 if(row&&!legacyOnly)return {definition:row.draft as FlowDefinition,published:row.published as FlowDefinition|null,revision:Number(row.revision)};
 let extra:FlowQuestion[]=[];
 if(kind==='hiring'){
  const [settings]=await handle.select().from(hrSettingsTable).where(eq(hrSettingsTable.tenantId,tenantId));
  const convert=(f:any,prefix=''):FlowQuestion=>({id:prefix+'q_'+String(f.id).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,40),label:f.label,type:['text','textarea','number','date','select','checkbox'].includes(f.type)?f.type:'text',required:!!f.required,options:f.options??[]});
  extra=((settings?.applicationFields as any[])??[]).map(f=>convert(f));
  const postings=await handle.select().from(hrPostingsTable).where(and(eq(hrPostingsTable.tenantId,tenantId),eq(hrPostingsTable.status,'open')));
  for(const p of postings)for(const f of (p.fields as any[]??[]))extra.push({...convert(f,`p${p.id}_`),condition:{field:'postingId',operator:'equals',value:String(p.id)}});
  const definition=defaultWebsiteFlow(kind,extra);
  definition.intro=settings?.applicationIntro??'';definition.privacyNotice=settings?.privacyNotice||definition.privacyNotice;
  return {definition,published:null,revision:0};
 }
 if(kind==='quote'){
  const [tenant]=await handle.select({customFields:tenantsTable.customFields}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  const fields=(tenant?.customFields as {customerFields?:any[]}|null)?.customerFields??[];
  extra=fields.filter(f=>f.visible!==false&&!['name','email','phone','address','city','state','zip','serviceIds'].includes(f.key)).map(f=>({id:'custom_'+String(f.key).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,40),label:f.label??f.key,type:['text','textarea','number','date','select','checkbox'].includes(f.type)?f.type:'text',required:!!f.required,options:f.options??[]}));
 }
 const definition=defaultWebsiteFlow(kind,extra);
 return {definition,published:null,revision:0};
}
export const canonicalJson=(v:unknown):string=>v===undefined?'null':JSON.stringify(Array.isArray(v)?v.map(x=>JSON.parse(canonicalJson(x))):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,JSON.parse(canonicalJson(x))])):v);
export function validateWebsiteAnswers(flow:FlowDefinition,raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||JSON.stringify(raw).length>100000)throw new HrError('Provide valid form answers');
 const error=validateFlowAnswers(flow,raw as Answers);if(error)throw new HrError(error);
 const visible=visibleFlow(flow,raw as Answers);
 if(visible.steps.some(s=>s.kind==='property')){
  for(const key of ['lat','lng'])if(visible.answers[key]!=null&&(typeof visible.answers[key]!=='number'||!Number.isFinite(visible.answers[key])||Math.abs(visible.answers[key] as number)>(key==='lat'?90:180)))throw new HrError('Provide a valid property pin');
  if(visible.answers.pinConfirmed!=null&&typeof visible.answers.pinConfirmed!=='boolean')throw new HrError('Confirm the property pin');
 }
 if(visible.steps.some(s=>s.kind==='property')&&visible.answers.pinConfirmed===true){
  if(typeof visible.answers.lat!=='number'||typeof visible.answers.lng!=='number'||Math.abs(visible.answers.lat)>90||Math.abs(visible.answers.lng)>180||!Number.isFinite(visible.answers.lat)||!Number.isFinite(visible.answers.lng))throw new HrError('Confirm a valid property pin');
 }
 // A required property step requires a confirmed point, not merely a typed address.
 if(visible.steps.some(s=>s.kind==='property'&&s.required)&&visible.answers.pinConfirmed!==true)throw new HrError('Confirm that the property pin is in the right place');
 return visible;
}
export function validateMeasurements(flow:FlowDefinition,answers:Answers,raw:unknown):{measurements:Measurements;areaSqft:number|null;lengthFt:number|null}{
 const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Measurements:{};
 const measurements:Measurements={};let areaSqft:number|null=null,lengthFt:number|null=null;
 for(const step of visibleFlow(flow,answers).steps.filter(s=>s.kind==='measurement')){
  const m=source[step.id];
  if(!m){if(step.required)throw new HrError(`${step.title} is required`);continue;}
  if(m.mode!==step.measurementMode||!Array.isArray(m.points)||m.points.length>500)throw new HrError('Provide a valid property measurement');
  const points=m.points;
  if(points.some(p=>!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180||Math.abs(p.lat-points[0].lat)>0.05||Math.abs(p.lng-points[0].lng)>0.05))throw new HrError('Draw a valid property boundary');
  let value=m.manual;
  if(points.length){
   if(points.length<(m.mode==='area'?3:2))throw new HrError('Complete the property boundary or line');
   const rad=(n:number)=>n*Math.PI/180;
   if(m.mode==='area'){
    const mean=points.reduce((a,p)=>a+p.lat,0)/points.length*Math.PI/180,origin=points[0];
    const xy=points.map(p=>({x:rad(p.lng-origin.lng)*6371008.8*Math.cos(mean),y:rad(p.lat-origin.lat)*6371008.8}));
    value=Math.abs(xy.reduce((n,p,i)=>{const b=xy[(i+1)%xy.length];return n+p.x*b.y-b.x*p.y;},0))/2*10.76391041671;
   }else value=points.slice(1).reduce((n,p,i)=>{const a=points[i],h=Math.sin(rad(p.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(p.lat))*Math.sin(rad(p.lng-a.lng)/2)**2;return n+2*6371008.8*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))*3.280839895;},0);
  }
  if(value==null&&!points.length){if(step.required)throw new HrError(`${step.title} is required`);continue;}
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>(m.mode==='area'?10000000:100000))throw new HrError('Enter a positive, reasonable measurement');
  if(!points.length){
   if(!step.allowApproximate)throw new HrError('Customer-estimated sizes are not enabled. Draw the measurement or ask the office to measure.');
   if(m.acceptedTerms!==true)throw new HrError('Agree to the approximate-size pricing terms before requesting this estimate');
  }
  measurements[step.id]={mode:m.mode,points,manual:points.length?undefined:value,source:points.length?'drawn':'approximate',...(!points.length?{acceptedTerms:true}:{})};
  if(m.mode==='area')areaSqft=(areaSqft??0)+value;else lengthFt=(lengthFt??0)+value;
 }
 return {measurements,areaSqft,lengthFt};
}
export async function calculateWebsitePreview(tenantId:number,answers:Answers,area:number|null,length:number|null,handle:HrDb=db):Promise<PricePreview|null>{
 const ids=Array.isArray(answers.serviceIds)?answers.serviceIds.map(Number):answers.serviceIds?[Number(answers.serviceIds)]:answers.serviceId?[Number(answers.serviceId)]:[];
 if(ids.length>50||ids.some(n=>!Number.isSafeInteger(n)||n<1)||new Set(ids).size!==ids.length)throw new HrError('Choose valid services');
 const all=await handle.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenantId),eq(servicesTable.isActive,true)));
 if(ids.some(id=>!all.some(s=>s.id===id)))throw new HrError('A selected service is no longer available');
 if(!ids.length||!(area||length))return null;
 const items=[];
 for(const id of ids){
  const service=all.find(s=>s.id===id)!;const mode=service.pricingMode??'flat';
  if(['matrix','per_sqft'].includes(mode)&&!area||mode==='per_linear_ft'&&!length)return null;
  if(!['flat','matrix','per_sqft','per_linear_ft'].includes(mode))return null;
  const price=Math.round(resolveServicePrice(mode,service.basePrice,service.pricingMatrix as PricingTier[]|null,area,length)*100)/100;
  if(!Number.isFinite(price)||price<=0)return null;
  items.push({serviceId:id,name:service.name,price});
 }
 return {items,total:Math.round(items.reduce((n,i)=>n+i.price,0)*100)/100};
}
