import { db,customerPlansTable,jobsTable,crewsTable,routeTemplatesTable } from "@workspace/db";
import { and,eq,inArray,sql } from "drizzle-orm";
import { generateRangeVisits,planDateInZone,VisitRangeError,type VisitRange } from "./planVisitRange";
import { capacityDate } from "./crewCapacity";
import type { PlanServiceRule,PlanVisitCandidate } from "./planSchedulingEngine";
import { isInOffSeason } from "./offSeasonUtils";

export interface ProgramJob extends PlanVisitCandidate {
  crewId:number|null;roundNumber:number;planVisitIndex:number;planVisitGroupKey:string;
  serviceIds:number[];serviceNames:string[];estimatedDuration:number;
  lineItems:Array<{id:string;serviceId:number;description:string;qty:number;unitPrice:number;markup:number;discount:number;chemicalTracking:boolean}>;
  routeTemplateId:number|null;offSeasonStart:string|null;offSeasonEnd:string|null;
}
type Catalog=Array<{id:number;name:string;estimatedDuration:number|null}>;
export async function buildPlanProgram(tenantId:number,rules:PlanServiceRule[],catalog:Catalog,schedule:VisitRange,zone:string,resolved=false):Promise<ProgramJob[]>{
  const allowed=new Set(rules.map(s=>s.serviceId));
  if(!rules.length)throw new VisitRangeError("Add services to the plan template first.");
  if(schedule.visitServices?.some(r=>r.serviceIds.some(id=>!allowed.has(id)))||
    schedule.serviceCrews?.some(r=>!allowed.has(r.serviceId))||schedule.chemicalServiceIds?.some(id=>!allowed.has(id)))
    throw new VisitRangeError("Every visit, crew assignment and chemical service must belong to this plan template.");
  const crewIds=[...new Set([schedule.defaultCrewId,...(schedule.serviceCrews??[]).map(r=>r.crewId)].filter((id):id is number=>!!id))];
  if(crewIds.length){
    const crews=await db.select({id:crewsTable.id}).from(crewsTable).where(and(eq(crewsTable.tenantId,tenantId),inArray(crewsTable.id,crewIds)));
    if(crews.length!==crewIds.length)throw new VisitRangeError("A selected crew is not available in this company.");
  }
  let roundDates=(resolved?(schedule as VisitRange & {roundDates?:string[]}).roundDates:undefined);
  if(schedule.alignToPlanId&&!resolved){
    const [source]=await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id,schedule.alignToPlanId),eq(customerPlansTable.tenantId,tenantId),eq(customerPlansTable.status,"active")));
    if(!source)throw new VisitRangeError("Choose an active existing plan to align with.");
    const sourceIds=((source.serviceState??[]) as PlanServiceRule[]).map(s=>s.serviceId);
    if(sourceIds.length!==allowed.size||sourceIds.some(id=>!allowed.has(id)))throw new VisitRangeError("Choose an existing plan with the same services.");
    const sourceJobs=await db.select().from(jobsTable).where(and(eq(jobsTable.planId,source.id),eq(jobsTable.tenantId,tenantId),sql`${jobsTable.status}<>'cancelled'`)).orderBy(jobsTable.scheduledAt);
    const after=[capacityDate(new Date(),zone),schedule.firstServiceDate].sort().at(-1)!;
    roundDates=[...new Set(sourceJobs.map(j=>capacityDate(j.scheduledAt,zone)).filter(day=>day>=after))];
    if(!roundDates.length&&source.visitSchedule){
      const saved=source.visitSchedule as VisitRange & {roundDates?:string[]};
      roundDates=(saved.roundDates??generateRangeVisits(saved,rules,saved.timeZone??zone).map(v=>capacityDate(v.date,zone))).filter(day=>day>=after);
    }
    if(!roundDates.length)throw new VisitRangeError("This plan has no remaining rounds. Choose another plan or its own service dates.");
    schedule.totalVisits=roundDates.length;
    schedule.firstServiceDate=roundDates[0];schedule.lastServiceDate=roundDates.at(-1)!;
    if(!schedule.visitServices?.length){
      const saved=source.visitSchedule as VisitRange|null;
      const originalDates=saved?((saved as VisitRange&{roundDates?:string[]}).roundDates??generateRangeVisits(saved,rules,saved.timeZone??zone).map(v=>capacityDate(v.date,zone))):[];
      schedule.visitServices=roundDates.map((day,i)=>{
        const matching=sourceJobs.filter(job=>capacityDate(job.scheduledAt,zone)===day);
        const ids=[...new Set(matching.flatMap(job=>{
          const lines=((job.lineItems??[]) as Array<{serviceId?:number}>).map(line=>line.serviceId).filter((id):id is number=>!!id&&allowed.has(id));
          return lines.length?lines:(job.serviceId&&allowed.has(job.serviceId)?[job.serviceId]:[]);
        }))];
        const original=originalDates.indexOf(day);
        return {visitNumber:i+1,serviceIds:ids.length?ids:(saved?.visitServices?.find(r=>r.visitNumber===original+1)?.serviceIds??[rules[Math.max(0,original)%rules.length].serviceId])};
      });
    }
    (schedule as VisitRange & {roundDates:string[]}).roundDates=roundDates;
  }
  const base=roundDates?roundDates.map((day,i)=>({
    serviceId:rules[i%rules.length].serviceId,serviceName:rules[i%rules.length].serviceName,date:planDateInZone(day,zone),idealDate:planDateInZone(day,zone),
    assigneeId:null,assigneeName:null,clustered:false,
  })):generateRangeVisits(schedule,rules,zone);
  let route:typeof routeTemplatesTable.$inferSelect|undefined;
  if(schedule.routeTemplateId){
    [route]=await db.select().from(routeTemplatesTable).where(and(eq(routeTemplatesTable.id,schedule.routeTemplateId),eq(routeTemplatesTable.tenantId,tenantId)));
    if(!route)throw new VisitRangeError("Choose a route belonging to this company.");
  }
  const jobs:ProgramJob[]=[];
  for(const [index,visit] of base.entries()){
    const configured=schedule.visitServices?.find(r=>r.visitNumber===index+1)?.serviceIds??[visit.serviceId];
    const groups=new Map<number|null,number[]>();
    for(const id of configured){
      const crew=schedule.serviceCrews?.find(r=>r.serviceId===id)?.crewId??schedule.defaultCrewId??null;
      groups.set(crew,[...(groups.get(crew)??[]),id]);
    }
    for(const [crewId,ids] of groups){
      const services=ids.map(id=>catalog.find(s=>s.id===id)!);
      if(services.some(s=>!s))throw new VisitRangeError("A service has been removed from the catalog.");
      if(route?.offSeasonStart&&route.offSeasonEnd&&isInOffSeason(new Date(`${capacityDate(visit.date,zone)}T12:00:00Z`),route.offSeasonStart,route.offSeasonEnd))
        throw new VisitRangeError("A visit falls in the selected route's off-season. Choose another route or service dates.");
      jobs.push({...visit,crewId,roundNumber:index+1,planVisitIndex:index,planVisitGroupKey:crewId?`crew:${crewId}`:"main",
        serviceId:ids[0],serviceName:services.map(s=>s.name).join(" + "),serviceIds:ids,serviceNames:services.map(s=>s.name),
        estimatedDuration:services.every(s=>Number(s.estimatedDuration)>0)?services.reduce((n,s)=>n+Number(s.estimatedDuration),0):0,
        lineItems:services.map(s=>({id:`plan-${index}-${s.id}`,serviceId:s.id,description:s.name,qty:1,unitPrice:0,markup:0,discount:0,chemicalTracking:schedule.chemicalServiceIds?.includes(s.id)??false})),
        routeTemplateId:route?.id??null,offSeasonStart:route?.offSeasonStart??null,offSeasonEnd:route?.offSeasonEnd??null,
      });
    }
  }
  return jobs;
}
