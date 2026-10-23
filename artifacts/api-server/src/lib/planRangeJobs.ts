import { db, customerPlansTable, jobsTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { generateRangeVisits,validateVisitRange, type VisitRange } from "./planVisitRange";
import type { PlanServiceRule } from "./planSchedulingEngine";
import { paymentGuardedJobInsert,SchedulingPaymentError } from "./paymentPolicy";

/** Retry missing authorized visits, never replace completed/cancelled/rescheduled slots. */
export async function generateRangeJobs(planId:number,tenantId:number):Promise<number>{
  return db.transaction(async tx=>{
    const [plan]=await tx.select().from(customerPlansTable).where(and(eq(customerPlansTable.id,planId),eq(customerPlansTable.tenantId,tenantId))).for("update");
    if(!plan?.visitSchedule || plan.status!=="active")return 0;
    const raw=plan.visitSchedule as VisitRange;
    const range=validateVisitRange(raw);
    const [tenant]=await tx.select({timezone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
    const visits=generateRangeVisits(range,plan.serviceState as PlanServiceRule[],raw.timeZone??tenant.timezone);
    const existing=await tx.select({slot:jobsTable.planVisitIndex}).from(jobsTable).where(and(eq(jobsTable.planId,planId),eq(jobsTable.tenantId,tenantId)));
    const occupied=new Set(existing.map(j=>j.slot));
    let added=0;
    for(const [slot,visit] of visits.entries()){
      if(occupied.has(slot))continue;
      try{
        await paymentGuardedJobInsert(tx).values({tenantId,customerId:plan.customerId,propertyId:plan.propertyId,planId,
          planVisitIndex:slot,serviceId:visit.serviceId,title:`${visit.serviceName} — Plan Visit`,
          status:"scheduled",priority:"normal",scheduledAt:visit.date});
        added++;
      }catch(error){if(!(error instanceof SchedulingPaymentError))throw error;}
    }
    return added;
  });
}
