import {customFetch} from '@workspace/api-client-react';
import type {FlowKind,FlowDefinition,Answers,Measurements,PricePreview,WebsiteSubmission} from '@workspace/api-client-react/website-flow';
export * from '@workspace/api-client-react/website-flow';
export interface WebsiteFormConfig {definition:FlowDefinition;published:FlowDefinition|null;revision:number}
export const loadWebsiteForm=(kind:FlowKind)=>customFetch<WebsiteFormConfig>(`/api/website-intake/forms/${kind}`);
export const saveWebsiteForm=(kind:FlowKind,definition:FlowDefinition,revision:number,publish:boolean)=>customFetch<WebsiteFormConfig>(`/api/website-intake/forms/${kind}`,{method:'PUT',body:JSON.stringify({definition,revision,publish})});
export const loadWebsiteSubmissions=(kind:FlowKind,before?:number)=>customFetch<{submissions:WebsiteSubmission[];nextCursor:number|null}>(`/api/website-intake/submissions?kind=${kind}${before?`&before=${before}`:''}`);
export interface ReviewInput {action:'approve'|'decline'|'review';notes?:string;customer?:{name:string;email?:string;phone?:string;address?:string;city?:string;state?:string;zip?:string};createEstimate?:boolean;areaSqft?:number;lengthFt?:number}
export const reviewWebsiteSubmission=(id:number,input:ReviewInput)=>customFetch<WebsiteSubmission>(`/api/website-intake/submissions/${id}/review`,{method:'POST',body:JSON.stringify(input)});
export interface PublicWebsiteConfig {tenantId:number;companyName:string;enabled:boolean;definition:FlowDefinition;revision:number;services:{id:number;name:string}[];postings:{id:number;title:string}[];privacyNotice:string}
export const loadPublicWebsiteForm=(input:{kind:FlowKind;tenantId?:string|number;slug?:string})=>customFetch<PublicWebsiteConfig>(`/api/public-intake/config?${new URLSearchParams(Object.entries(input).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]))}`);
export const submitPublicWebsiteForm=(input:{tenantId:number;kind:FlowKind;requestId:string;revision:number;answers:Answers;measurements:Measurements;consent:boolean;referralCode?:string;doorHangerCode?:string},resume?:File)=>{
 const data=resume?new FormData():null;
 if(data){data.append('submission',JSON.stringify(input));data.append('resume',resume!);}
 return customFetch<{received:true;pendingReview:true;reference:string;preview:PricePreview|null}>('/api/public-intake/submit',{method:'POST',body:data??JSON.stringify(input)});
};
