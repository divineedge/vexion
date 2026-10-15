/** Browser-safe intake language shared by the editor, public renderer and API. */
export type FlowKind='quote'|'hiring';
export type Answers=Record<string,unknown>;
export interface FlowCondition {field:string;operator:'equals'|'not_equals'|'contains'|'answered';value:string}
export interface FlowQuestion {id:string;label:string;type:'text'|'textarea'|'email'|'phone'|'number'|'date'|'select'|'multiselect'|'checkbox';required:boolean;options:string[];condition?:FlowCondition|null}
export interface FlowStep {id:string;title:string;kind:'questions'|'property'|'measurement';required:boolean;measurementMode:'area'|'linear';allowPinMove:boolean;allowApproximate?:boolean;approximateTerms?:string;condition?:FlowCondition|null;questions:FlowQuestion[]}
export interface FlowDefinition {title:string;intro:string;privacyNotice:string;successMessage:string;steps:FlowStep[];uploads?:{enabled:boolean;required:boolean;label:string}}
export interface Measurement {mode:'area'|'linear';points:{lat:number;lng:number}[];manual?:number;source?:'drawn'|'approximate';acceptedTerms?:boolean}
export const APPROXIMATE_SIZE_TERMS='My estimate is based on the approximate size I provide, which has not been verified. The business may propose a different price after the office verifies the measurements or after the first service reveals the actual area or work required. The business must explain any proposed price change and get my approval before charging the revised amount. I understand this is a preliminary estimate, not a guaranteed final price.';
export type Measurements=Record<string,Measurement>;
export interface PricePreview {items:{serviceId:number;name:string;price:number}[];total:number}
export interface WebsiteSubmission {id:number;kind:FlowKind;status:string;payload:{answers:Answers;measurements:Measurements;[key:string]:unknown};snapshot:FlowDefinition;preview:PricePreview|null;createdAt:string;customerId?:number|null;propertyId?:number|null;estimateId?:number|null;applicationId?:number|null;reviewNotes?:string|null;reviewedBy?:number|null;reviewedAt?:string|null;reviewData?:{customerChoice?:'existing'|'created'|null;propertyChoice?:'existing'|'created'|null;[key:string]:unknown}|null;path?:string[]}
export const answered=(v:unknown)=>Array.isArray(v)?v.length>0:typeof v==='boolean'?v:v!=null&&String(v).trim()!=='';
function matches(c:FlowCondition|null|undefined,answers:Answers) {
  if(!c)return true;
  const v=answers[c.field];
  if(c.operator==='answered')return answered(v);
  if(v==null||v===''||(Array.isArray(v)&&v.length===0))return false;
  if(c.operator==='contains')return Array.isArray(v)?v.map(String).includes(c.value):String(v??'').includes(c.value);
  const equal=String(v??'')===c.value;
  return c.operator==='not_equals'?!equal:equal;
}
export function visibleFlow(def:FlowDefinition,raw:Answers):{steps:FlowStep[];answers:Answers} {
  // Drizzle's JSON value inspection expects ordinary objects, not null prototypes.
  // Definitions reject reserved IDs; unknown answer keys are never copied.
  const answers:Answers={},steps:FlowStep[]=[];
  for(const s of def.steps) {
    if(!matches(s.condition,answers))continue;
    const questions:FlowQuestion[]=[];
    for(const q of s.questions)if(matches(q.condition,answers)){
      questions.push(q);if(Object.hasOwn(raw,q.id))answers[q.id]=raw[q.id];
    }
    steps.push({...s,questions});
    if(s.kind==='property')for(const key of ['lat','lng','pinConfirmed'])if(Object.hasOwn(raw,key))answers[key]=raw[key];
  }
  return {steps,answers};
}
export function validateFlowAnswers(def:FlowDefinition,raw:Answers):string|null {
  const {steps,answers}=visibleFlow(def,raw);
  for(const s of steps)for(const q of s.questions) {
    const v=answers[q.id];if(q.required&&!answered(v))return `${q.label} is required`;
    if(!answered(v))continue;
    if(q.type==='multiselect'&&(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string')))return `Choose valid answers for ${q.label}`;
    if(!['multiselect','checkbox'].includes(q.type)&&!['string','number'].includes(typeof v))return `Enter a valid ${q.label}`;
    if(q.type==='checkbox'&&typeof v!=='boolean')return `Choose a valid ${q.label}`;
    if(String(v).length>10000)return `${q.label} is too long`;
    if(q.type==='number'&&!Number.isFinite(Number(v)))return `${q.label} must be a number`;
    if(q.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)))return `Enter a valid ${q.label}`;
    if(q.type==='phone'&&(String(v).replace(/\D/g,'').length<7||String(v).replace(/\D/g,'').length>25))return `Enter a valid ${q.label}`;
    if(q.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(v))||!Number.isFinite(Date.parse(String(v)))||new Date(String(v)).toISOString().slice(0,10)!==v))return `Enter a valid ${q.label}`;
    if(q.options.length&&!['serviceIds','postingId'].includes(q.id)&&(Array.isArray(v)?v:[v]).some(x=>!q.options.includes(String(x))))return `Choose a listed option for ${q.label}`;
  }
  return null;
}
export function defaultWebsiteFlow(kind:FlowKind,extra:FlowQuestion[]=[]):FlowDefinition {
  const q=(id:string,label:string,type:FlowQuestion['type']='text',required=true):FlowQuestion=>({id,label,type,required,options:[]});
  const s=(id:string,title:string,questions:FlowQuestion[],kind:FlowStep['kind']='questions'):FlowStep=>({id,title,kind,questions,required:false,measurementMode:'area',allowPinMove:true});
  return {title:kind==='quote'?'Request an estimate':'Apply to join our team',intro:'',privacyNotice:'We will store your submission and contact you about this request. This does not subscribe you to marketing.',successMessage:'Thank you. Your submission is awaiting staff review.',
    steps:kind==='quote'?[s('contact','Your information',[q('name','Name'),q('email','Email','email'),q('phone','Phone','phone',false)]),
      s('services','What would you like done?',[q('serviceIds','Services','multiselect')]),
      s('property','Property address',[q('address','Street address'),q('city','City'),q('state','State'),q('zip','ZIP')],'property'),
      s('measure','Measure your property (optional)',[],'measurement'),...(extra.length?[s('additional','Additional questions',extra)]:[])]
      :[s('contact','Your information',[q('name','Full name'),q('email','Email','email'),q('phone','Phone','phone',false),q('postingId','Position','select',false)]),...(extra.length?[s('additional','Application questions',extra)]:[])]};
}
