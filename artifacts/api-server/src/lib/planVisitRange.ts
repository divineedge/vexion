import type { PlanServiceRule, PlanVisitCandidate } from "./planSchedulingEngine";

const DAY=86_400_000;
export interface VisitRange {
  firstServiceDate:string;
  lastServiceDate:string;
  totalVisits:number;
  spacingUnit:"weeks"|"days";
  preferredWeekday:number;
  timeZone?:string;
  alignToPlanId?:number;
  defaultCrewId?:number;
  routeTemplateId?:number;
  capacityOverrideReason?:string;
  overrideApprovedBy?:number;
  visitServices?:Array<{visitNumber:number;serviceIds:number[]}>;
  serviceCrews?:Array<{serviceId:number;crewId:number}>;
  chemicalServiceIds?:number[];
  emailReminder?:boolean;
  smsReminder?:boolean;
  pushReminder?:boolean;
}
export class VisitRangeError extends Error {}
function calendarDate(key:unknown):Date {
  if(typeof key!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(key))throw new VisitRangeError("Enter valid first and last service dates.");
  const date=new Date(`${key}T12:00:00Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==key)throw new VisitRangeError("Enter valid first and last service dates.");
  return date;
}
export function validateVisitRange(input:unknown):VisitRange {
  if(!input||typeof input!=="object"||Array.isArray(input))throw new VisitRangeError("Enter the service date range.");
  const value=input as Record<string,unknown>;
  const start=calendarDate(value.firstServiceDate),end=calendarDate(value.lastServiceDate);
  const span=(end.getTime()-start.getTime())/DAY;
  const singleAligned=value.alignToPlanId && value.totalVisits===1 && span===0;
  if((span<=0&&!singleAligned)||span>3660)throw new VisitRangeError("The last service must be after the first and within ten years.");
  if(!Number.isInteger(value.totalVisits)||Number(value.totalVisits)<(singleAligned?1:2)||Number(value.totalVisits)>366)
    throw new VisitRangeError("Choose between 2 and 366 total services, including the first and last.");
  if(!Number.isInteger(value.preferredWeekday)||Number(value.preferredWeekday)<0||Number(value.preferredWeekday)>6)
    throw new VisitRangeError("Choose a preferred weekday.");
  const unit=value.spacingUnit??"weeks";
  if(unit!=="days"&&unit!=="weeks")throw new VisitRangeError("Choose days or weeks.");
  const result:VisitRange={firstServiceDate:value.firstServiceDate as string,lastServiceDate:value.lastServiceDate as string,
    totalVisits:Number(value.totalVisits),preferredWeekday:Number(value.preferredWeekday),spacingUnit:unit};
  for(const field of ["alignToPlanId","defaultCrewId","routeTemplateId"] as const){
    if(value[field]!=null){if(!Number.isSafeInteger(value[field])||Number(value[field])<=0)throw new VisitRangeError("Choose a valid plan, crew, or route.");result[field]=Number(value[field]);}
  }
  for(const field of ["emailReminder","smsReminder","pushReminder"] as const){
    if(value[field]!==undefined&&typeof value[field]!=="boolean")throw new VisitRangeError("Choose valid reminder channels.");
    result[field]=value[field]===undefined?field==="emailReminder":value[field] as boolean;
  }
  if(value.capacityOverrideReason!==undefined){
    if(typeof value.capacityOverrideReason!=="string"||value.capacityOverrideReason.length>1000)throw new VisitRangeError("Enter a capacity override reason of at most 1000 characters.");
    result.capacityOverrideReason=value.capacityOverrideReason.trim();
  }
  if(value.visitServices!==undefined){
    if(!Array.isArray(value.visitServices)||value.visitServices.length>366)throw new VisitRangeError("Invalid services-per-visit configuration.");
    result.visitServices=value.visitServices.map((r:any)=>{
      if(!r||!Number.isInteger(r.visitNumber)||r.visitNumber<1||r.visitNumber>366||!Array.isArray(r.serviceIds)||!r.serviceIds.length||
        r.serviceIds.length>100||r.serviceIds.some((id:unknown)=>!Number.isSafeInteger(id)||Number(id)<=0))throw new VisitRangeError("Choose at least one valid service for each visit.");
      return {visitNumber:r.visitNumber,serviceIds:[...new Set<number>(r.serviceIds)]};
    });
  }
  if(value.serviceCrews!==undefined){
    if(!Array.isArray(value.serviceCrews)||value.serviceCrews.length>100)throw new VisitRangeError("Invalid service crew assignments.");
    result.serviceCrews=value.serviceCrews.map((r:any)=>{
      if(!r||![r.serviceId,r.crewId].every(n=>Number.isSafeInteger(n)&&n>0))throw new VisitRangeError("Choose a valid service and crew.");
      return {serviceId:r.serviceId,crewId:r.crewId};
    });
  }
  if(value.chemicalServiceIds!==undefined){
    if(!Array.isArray(value.chemicalServiceIds)||value.chemicalServiceIds.length>100||value.chemicalServiceIds.some(id=>!Number.isSafeInteger(id)||id<=0))
      throw new VisitRangeError("Choose valid services for chemical tracking.");
    result.chemicalServiceIds=[...new Set<number>(value.chemicalServiceIds)];
  }
  return result;
}
/** Calendar noon in the company's timezone, independent of device/server timezone and DST. */
export function planDateInZone(key:string,timeZone:string):Date {
  const target=calendarDate(key).getTime();
  let instant=target;
  const formatter=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  for(let i=0;i<3;i++){
    const parts=formatter.formatToParts(new Date(instant));
    const n=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
    const shown=Date.UTC(n("year"),n("month")-1,n("day"),n("hour"),n("minute"),n("second"));
    instant+=target-shown;
  }
  return new Date(instant);
}
export function generateRangeVisits(input:unknown,services:PlanServiceRule[],timeZone:string):PlanVisitCandidate[] {
  const range=validateVisitRange(input);
  if(!services.length)throw new VisitRangeError("Add a service to the plan template first.");
  const first=calendarDate(range.firstServiceDate),last=calendarDate(range.lastServiceDate);
  const span=(last.getTime()-first.getTime())/DAY;
  const result:PlanVisitCandidate[]=[];
  let previous=-1;
  for(let i=0;i<range.totalVisits;i++){
    const idealOffset=range.totalVisits===1?0:span*i/(range.totalVisits-1);
    let offset:number;
    if(i===0)offset=0;
    else if(i===range.totalVisits-1)offset=span;
    else{
      let firstMatch=(range.preferredWeekday-first.getUTCDay()+7)%7;
      if(firstMatch===0)firstMatch=7; // endpoints are not interior visits
      const lastIndex=Math.floor((span-1-firstMatch)/7);
      if(lastIndex<0)throw new VisitRangeError("No preferred weekdays fit between these service dates. Extend the date range.");
      const index=Math.max(0,Math.min(lastIndex,Math.round((idealOffset-firstMatch)/7)));
      offset=firstMatch+index*7;
    }
    if(offset<=previous)throw new VisitRangeError("These visits would overlap on the preferred weekday. Use fewer services or extend the date range.");
    previous=offset;
    const key=new Date(first.getTime()+offset*DAY).toISOString().slice(0,10);
    const service=services[i%services.length];
    result.push({serviceId:service.serviceId,serviceName:service.serviceName,date:planDateInZone(key,timeZone),
      idealDate:new Date(first.getTime()+idealOffset*DAY),assigneeId:null,assigneeName:null,clustered:false});
  }
  return result;
}
