import { db,crewsTable,crewMembersTable,jobsTable,tenantsTable,activityLogTable,usersTable } from "@workspace/db";
import { and,eq,inArray,sql,type SQL } from "drizzle-orm";
import { isAdminRole } from "./roles";
import { planDateInZone } from "./planVisitRange";
import { formsGuardedJobUpdate } from "./jobForms";

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Job=typeof jobsTable.$inferInsert & {id?:number};
export interface CapacityApproval {actorId?:number;reason?:string;autoPlace?:boolean;preview?:boolean;virtualJobs?:Job[]}
export class CrewCapacityError extends Error {
  status=409;
  constructor(message:string){super(message);this.name="CrewCapacityError";}
}
export function capacityDate(date:Date,zone:string){
  return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
export async function enforceCrewCapacity(tx:Tx,job:Job,approval:CapacityApproval={}):Promise<Job>{
  if(job.archivedAt||["cancelled","draft","rejected"].includes(job.status??"scheduled"))return job;
  if(!job.crewId)return job.assigneeId?enforceIndividualCapacity(tx,job,approval):job;
  const [crew]=await tx.select().from(crewsTable).where(and(eq(crewsTable.id,job.crewId),eq(crewsTable.tenantId,job.tenantId)));
  if(!crew)throw new CrewCapacityError("This crew is not available in this company.");
  const members=await tx.select().from(crewMembersTable).where(and(eq(crewMembersTable.tenantId,job.tenantId),eq(crewMembersTable.crewId,crew.id)));
  const userIds=[...new Set([...members.map(m=>m.userId),...(job.assigneeId?[job.assigneeId]:[])])];
  const shared=userIds.length?await tx.select().from(crewMembersTable).where(and(eq(crewMembersTable.tenantId,job.tenantId),inArray(crewMembersTable.userId,userIds))):[];
  const crewIds=[...new Set([crew.id,...shared.map(m=>m.crewId)])].sort((a,b)=>a-b);
  // All writers lock the same crews in the same order before reading occupancy.
  await tx.select({id:crewsTable.id}).from(crewsTable).where(and(eq(crewsTable.tenantId,job.tenantId),inArray(crewsTable.id,crewIds))).orderBy(crewsTable.id).for("update");
  if(userIds.length)await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,job.tenantId),inArray(usersTable.id,userIds))).orderBy(usersTable.id).for("update");
  const [company]=await tx.select({zone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,job.tenantId));
  const day=capacityDate(job.scheduledAt,company.zone);
  const rows=await tx.select().from(jobsTable).where(and(eq(jobsTable.tenantId,job.tenantId),
    sql`(${jobsTable.scheduledAt} AT TIME ZONE ${company.zone})::date=${day}::date`,
    sql`${jobsTable.status} NOT IN ('cancelled','draft','rejected')`,sql`${jobsTable.archivedAt} IS NULL`));
  const booked=[...rows,...(approval.virtualJobs??[])].filter(j=>j.id!==job.id && capacityDate(j.scheduledAt,company.zone)===day &&
    ((j.crewId!=null&&crewIds.includes(j.crewId))||(j.assigneeId!=null&&userIds.includes(j.assigneeId))));
  const duration=Number(job.estimatedDuration??0),buffer=crew.travelBufferMinutes,requested=duration+buffer;
  const used=booked.reduce((sum,j)=>sum+Number(j.estimatedDuration??0)+buffer,0);
  let warning:string|undefined;
  let scheduledAt=job.scheduledAt;
  if(!(duration>0)||booked.some(j=>!(Number(j.estimatedDuration)>0)))
    warning=`${crew.name} on ${day}: an estimated duration is missing. Enter the duration to check capacity, choose another day/crew, or approve an override.`;
  else if(used+requested>crew.dailyCapacityMinutes)
    warning=`${crew.name} on ${day}: ${used} minutes booked + ${requested} minutes including travel buffer exceeds its ${crew.dailyCapacityMinutes}-minute day. Reschedule or choose another crew.`;
  else if(approval.autoPlace){
    const start=new Date(planDateInZone(day,company.zone).getTime()-4*3600000);
    const end=start.getTime()+crew.dailyCapacityMinutes*60000;
    let cursor=start.getTime();
    for(const other of [...booked].sort((a,b)=>a.scheduledAt.getTime()-b.scheduledAt.getTime())){
      const from=other.scheduledAt.getTime(),until=from+(Number(other.estimatedDuration)+buffer)*60000;
      if(until<=cursor)continue;
      if(cursor+requested*60000<=from)break;
      cursor=Math.max(cursor,until);
    }
    if(cursor+requested*60000>end)warning=`${crew.name} on ${day}: there is no uninterrupted time for this service in its planned working day. Choose another day or crew.`;
    else scheduledAt=new Date(cursor);
  }else{
    const from=scheduledAt.getTime(),until=from+requested*60000;
    if(booked.some(other=>from<other.scheduledAt.getTime()+(Number(other.estimatedDuration)+buffer)*60000 && until>other.scheduledAt.getTime()))
      warning=`${crew.name} on ${day}: this time overlaps another assigned job. Choose another time/day or crew.`;
  }
  if(warning){
    const reason=approval.reason?.trim();
    if(!approval.actorId||!reason||reason.length<5||reason.length>1000||!await isAdminRole(job.tenantId,approval.actorId))
      throw new CrewCapacityError(warning+" An owner or authorized manager may override with a reason.");
    if(!approval.preview)await tx.insert(activityLogTable).values({tenantId:job.tenantId,userId:approval.actorId,type:"crew_capacity_override",entityId:job.id??job.planId??crew.id,message:`${warning} Override approved: ${reason}`});
    return {...job,capacityOverrideReason:reason,capacityOverrideBy:approval.actorId,capacityOverrideAt:new Date()};
  }
  return {...job,scheduledAt,capacityOverrideReason:null,capacityOverrideBy:null,capacityOverrideAt:null};
}

async function enforceIndividualCapacity(tx:Tx,job:Job,approval:CapacityApproval):Promise<Job>{
  const memberships=await tx.select().from(crewMembersTable).where(and(eq(crewMembersTable.tenantId,job.tenantId),eq(crewMembersTable.userId,job.assigneeId!)));
  const crewIds=[...new Set(memberships.map(member=>member.crewId))].sort((a,b)=>a-b);
  const crews=crewIds.length?await tx.select().from(crewsTable).where(and(eq(crewsTable.tenantId,job.tenantId),inArray(crewsTable.id,crewIds))).orderBy(crewsTable.id).for("update"):[];
  const [employee]=await tx.select().from(usersTable).where(and(eq(usersTable.id,job.assigneeId!),eq(usersTable.tenantId,job.tenantId))).for("update");
  if(!employee)throw new CrewCapacityError("This employee is not available in this company.");
  const [company]=await tx.select({zone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,job.tenantId));
  const day=capacityDate(job.scheduledAt,company.zone);
  const rows=await tx.select().from(jobsTable).where(and(eq(jobsTable.tenantId,job.tenantId),sql`(${jobsTable.scheduledAt} AT TIME ZONE ${company.zone})::date=${day}::date`,sql`${jobsTable.status} NOT IN ('cancelled','draft','rejected')`,sql`${jobsTable.archivedAt} IS NULL`));
  const booked=[...rows,...(approval.virtualJobs??[])].filter(other=>other.id!==job.id&&capacityDate(other.scheduledAt,company.zone)===day&&(other.assigneeId===job.assigneeId||(other.crewId!=null&&crewIds.includes(other.crewId))));
  const limit=crews.length?Math.max(...crews.map(crew=>crew.dailyCapacityMinutes)):480;
  const buffer=crews.length?Math.max(...crews.map(crew=>crew.travelBufferMinutes)):15;
  const duration=Number(job.estimatedDuration)||0;
  let scheduledAt=job.scheduledAt;
  const requested=duration+buffer;
  const used=booked.reduce((total,other)=>total+Math.max(0,Number(other.estimatedDuration)||0)+buffer,0);
  let warning:string|undefined;
  if(duration<=0||booked.some(other=>!(Number(other.estimatedDuration)>0)))warning=`${employee.name} on ${day}: an estimated duration is missing. Enter this job's duration to check capacity; existing jobs also need durations.`;
  else if(used+requested>limit)warning=`${employee.name} on ${day}: ${used} minutes booked + ${requested} minutes including travel exceeds the ${limit}-minute working day.`;
  else if(approval.autoPlace){
    const start=planDateInZone(day,company.zone).getTime()-4*3600000,end=start+limit*60000;
    let cursor=start;
    for(const other of [...booked].sort((a,b)=>a.scheduledAt.getTime()-b.scheduledAt.getTime())){
      const until=other.scheduledAt.getTime()+(Number(other.estimatedDuration)+buffer)*60000;
      if(until<=cursor)continue;
      if(cursor+requested*60000<=other.scheduledAt.getTime())break;
      cursor=Math.max(cursor,until);
    }
    if(cursor+requested*60000>end)warning=`${employee.name} on ${day}: there is no uninterrupted time left in the working day. Choose another day or employee.`;
    else scheduledAt=new Date(cursor);
  }
  else if(booked.some(other=>job.scheduledAt.getTime()<other.scheduledAt.getTime()+(Number(other.estimatedDuration)+buffer)*60000&&job.scheduledAt.getTime()+requested*60000>other.scheduledAt.getTime()))warning=`${employee.name} on ${day}: this time overlaps another individual or crew assignment. Choose another time, day, or employee.`;
  if(warning){
    const reason=approval.reason?.trim();
    if(!approval.actorId||!reason||reason.length<5||reason.length>1000||!await isAdminRole(job.tenantId,approval.actorId))throw new CrewCapacityError(warning+" An owner or authorized manager may override with a reason.");
    if(!approval.preview)await tx.insert(activityLogTable).values({tenantId:job.tenantId,userId:approval.actorId,type:"crew_capacity_override",entityId:job.id??job.planId??employee.id,message:`${warning} Override approved: ${reason}`});
    return {...job,capacityOverrideReason:reason,capacityOverrideBy:approval.actorId,capacityOverrideAt:new Date()};
  }
  return {...job,scheduledAt,capacityOverrideReason:null,capacityOverrideBy:null,capacityOverrideAt:null};
}

/** Capacity check and updates share a transaction, including bulk reschedules. */
export async function capacityCheckedJobUpdate(where:SQL,updates:Partial<typeof jobsTable.$inferInsert>,approval:CapacityApproval={}){
  return db.transaction(async tx=>{
    const rows=await tx.select().from(jobsTable).where(where).orderBy(jobsTable.id).for("update");
    const changed:Array<typeof jobsTable.$inferSelect>=[];
    for(const row of rows){
      const dateChanged=updates.scheduledAt!==undefined&&updates.scheduledAt.getTime()!==row.scheduledAt.getTime();
      const next={...row,...updates};
      const schedulingChanged=next.crewId!==row.crewId||next.assigneeId!==row.assigneeId||next.scheduledAt.getTime()!==row.scheduledAt.getTime()||next.estimatedDuration!==row.estimatedDuration;
      const checked=schedulingChanged?await enforceCrewCapacity(tx,next,approval):next;
      const [saved]=await formsGuardedJobUpdate(tx).set({...updates,
        ...(dateChanged?{remindersSent:{}}:{}),
        ...(schedulingChanged?{capacityOverrideReason:checked.capacityOverrideReason??null,capacityOverrideBy:checked.capacityOverrideBy??null,capacityOverrideAt:checked.capacityOverrideAt??null}:{}),
      }).where(and(eq(jobsTable.id,row.id),eq(jobsTable.tenantId,row.tenantId))).returning();
      changed.push(saved);
    }
    return changed;
  });
}
