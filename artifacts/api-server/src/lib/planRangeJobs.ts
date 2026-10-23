import { db, customerPlansTable, jobsTable, tenantsTable,servicesTable,activityLogTable } from "@workspace/db";
import { and, eq,inArray } from "drizzle-orm";
import { generateRangeVisits,validateVisitRange, type VisitRange } from "./planVisitRange";
import type { PlanServiceRule } from "./planSchedulingEngine";
import { paymentGuardedJobInsert,SchedulingPaymentError } from "./paymentPolicy";
import { buildPlanProgram } from "./planProgram";
import { CrewCapacityError } from "./crewCapacity";

/** Retry missing authorized visits, never replace completed/cancelled/rescheduled slots. */
export async function generateRangeJobs(planId:number,tenantId:number):Promise<number>{
  return db.transaction(async tx=>{
    const [plan]=await tx.select().from(customerPlansTable).where(and(eq(customerPlansTable.id,planId),eq(customerPlansTable.tenantId,tenantId))).for("update");
    if(!plan?.visitSchedule || plan.status!=="active")return 0;
    const raw=plan.visitSchedule as VisitRange;
    const range=validateVisitRange(raw);
    const [tenant]=await tx.select({timezone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    Object.assign(range,{roundDates:(raw as any).roundDates});
    const rules=plan.serviceState as PlanServiceRule[];
    const catalog=await tx.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenantId),inArray(servicesTable.id,rules.map(s=>s.serviceId))));
    const visits=await buildPlanProgram(tenantId,rules,catalog,range,raw.timeZone??tenant.timezone,true);
    const existing=await tx.select({slot:jobsTable.planVisitIndex,group:jobsTable.planVisitGroupKey}).from(jobsTable).where(and(eq(jobsTable.planId,planId),eq(jobsTable.tenantId,tenantId)));
    const occupied=new Set(existing.map(j=>`${j.slot}:${j.group}`));
    let added=0;
    for(const visit of visits){
      if(occupied.has(`${visit.planVisitIndex}:${visit.planVisitGroupKey}`))continue;
      try{
        await paymentGuardedJobInsert(tx,{autoPlace:true,actorId:raw.overrideApprovedBy,reason:range.capacityOverrideReason}).values({tenantId,customerId:plan.customerId,propertyId:plan.propertyId,planId,
          planVisitIndex:visit.planVisitIndex,planVisitGroupKey:visit.planVisitGroupKey,serviceId:visit.serviceId,title:`${visit.serviceName} — Plan Visit`,
          crewId:visit.crewId,estimatedDuration:visit.estimatedDuration,lineItems:visit.lineItems,routeTemplateId:visit.routeTemplateId,
          offSeasonStart:visit.offSeasonStart,offSeasonEnd:visit.offSeasonEnd,
          emailReminderEnabled:range.emailReminder,smsReminderEnabled:range.smsReminder,pushReminderEnabled:range.pushReminder,
          status:"scheduled",priority:"normal",scheduledAt:visit.date});
        added++;
      }catch(error){
        if(!(error instanceof SchedulingPaymentError)&&!(error instanceof CrewCapacityError))throw error;
        if(error instanceof CrewCapacityError){
          const message=`${plan.templateName}: a future visit needs rescheduling or a manager capacity override. ${error.message}`;
          const [known]=await tx.select({id:activityLogTable.id}).from(activityLogTable).where(and(eq(activityLogTable.tenantId,tenantId),eq(activityLogTable.type,"plan_capacity_blocked"),eq(activityLogTable.entityId,planId),eq(activityLogTable.message,message))).limit(1);
          if(!known)await tx.insert(activityLogTable).values({tenantId,type:"plan_capacity_blocked",entityId:planId,message});
        }
      }
    }
    return added;
  });
}
