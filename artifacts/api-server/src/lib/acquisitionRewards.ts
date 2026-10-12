import { db, customersTable, invoicesTable, tenantsTable, usersTable, customerCreditsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
export type AcquisitionSettings = {
  doorHangersEnabled:boolean; employeeRewardsEnabled:boolean; employeeRewardType:"fixed"|"percent"; employeeRewardValue:number;
  customerReferralsEnabled:boolean; referralRewardType:"fixed"|"percent"; referralRewardValue:number;
  trigger:"first_paid_invoice"; quoteWidgetEnabled:boolean;
};
export const defaultAcquisitionSettings: AcquisitionSettings = { doorHangersEnabled:false, employeeRewardsEnabled:false,
  employeeRewardType:"fixed", employeeRewardValue:0, customerReferralsEnabled:false, referralRewardType:"fixed", referralRewardValue:0,
  trigger:"first_paid_invoice", quoteWidgetEnabled:false };
export function acquisitionSettings(value: unknown): AcquisitionSettings {
  return { ...defaultAcquisitionSettings, ...(value && typeof value==="object" ? value : {}), trigger:"first_paid_invoice" };
}
/** Eligibility is frozen at attribution time; never invent bonuses for legacy paid customers. */
type AcquisitionDb=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function saveAcquisitionAttribution(tenantId:number, customerId:number, input:{ acquiredByEmployeeId?:number|null; doorHangerVisitId?:number|null },handle:AcquisitionDb=db) {
  const [customer] = await handle.select().from(customersTable).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,customerId)));
  if (!customer) throw new Error("Customer not found");
  let employeeId = input.acquiredByEmployeeId!==undefined ? input.acquiredByEmployeeId : customer.acquiredByEmployeeId;
  let visitId = input.doorHangerVisitId!==undefined ? input.doorHangerVisitId : customer.doorHangerVisitId;
  if (visitId) {
    const visit = await handle.execute(sql`SELECT employee_id,converted_customer_id FROM door_hanger_visits WHERE id=${visitId} AND tenant_id=${tenantId} FOR UPDATE`);
    if (!visit.rows.length || visit.rows[0].converted_customer_id && visit.rows[0].converted_customer_id!==customerId) throw new Error("Door hanger is already attributed or not in this company");
    employeeId = Number(visit.rows[0].employee_id);
  }
  if (employeeId) {
    const [employee] = await handle.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,employeeId)));
    if (!employee) throw new Error("Employee not in this company");
  }
  const [tenant] = await handle.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  const snapshot = { ...acquisitionSettings(tenant?.acquisitionSettings), assignedAt:new Date().toISOString() };
  await handle.transaction(async tx => {
    const paid = await tx.select({id:invoicesTable.id}).from(invoicesTable).where(and(eq(invoicesTable.tenantId,tenantId),eq(invoicesTable.customerId,customerId),eq(invoicesTable.status,"paid")));
    if (paid.length && (employeeId!==customer.acquiredByEmployeeId || visitId!==customer.doorHangerVisitId)) throw new Error("Paid customer acquisition attribution cannot be changed");
    await tx.execute(sql`UPDATE customers SET acquired_by_employee_id=${employeeId},door_hanger_visit_id=${visitId},
      acquisition_reward_snapshot=COALESCE(acquisition_reward_snapshot,${JSON.stringify(snapshot)}::jsonb)
      WHERE id=${customerId} AND tenant_id=${tenantId}`);
    if (visitId) await tx.execute(sql`UPDATE door_hanger_visits SET converted_customer_id=${customerId}
      WHERE id=${visitId} AND tenant_id=${tenantId} AND (converted_customer_id IS NULL OR converted_customer_id=${customerId})`);
  });
}
export async function processAcquisitionRewards(tenantId:number,handle:AcquisitionDb=db) {
  const candidates = await handle.execute(sql`SELECT c.id FROM customers c WHERE c.tenant_id=${tenantId}
    AND c.acquisition_reward_snapshot IS NOT NULL
    AND ((c.acquired_by_employee_id IS NOT NULL AND c.acquisition_reward_snapshot->>'employeeRewardsEnabled'='true'
      AND (c.acquisition_reward_snapshot->>'employeeRewardValue')::numeric>0)
      OR (c.referring_customer_id IS NOT NULL AND c.acquisition_reward_snapshot->>'customerReferralsEnabled'='true'
      AND (c.acquisition_reward_snapshot->>'referralRewardValue')::numeric>0))
    AND EXISTS(SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.tenant_id=c.tenant_id AND i.status='paid' AND i.total>0 AND i.paid_at>=(c.acquisition_reward_snapshot->>'assignedAt')::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.tenant_id=c.tenant_id AND i.status='paid' AND i.total>0 AND i.paid_at<(c.acquisition_reward_snapshot->>'assignedAt')::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM acquisition_rewards r WHERE r.customer_id=c.id AND r.tenant_id=c.tenant_id) LIMIT 100`);
  for (const row of candidates.rows) await handle.transaction(async tx => {
    // Same tenant boundary as payroll approval; money earned during approval goes into the next open period.
    await tx.select({id:tenantsTable.id}).from(tenantsTable).where(eq(tenantsTable.id,tenantId)).for("no key update");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('acquisition-reward'),hashtext(${`${tenantId}:${Number(row.id)}`}))`);
    const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.id,Number(row.id)),eq(customersTable.tenantId,tenantId)));
    if (!customer) return;
    const snapshot = customer.acquisitionRewardSnapshot as AcquisitionSettings & {assignedAt:string};
    const first = await tx.execute(sql`SELECT id,total,tax,paid_at FROM invoices WHERE tenant_id=${tenantId} AND customer_id=${customer.id}
      AND status='paid' AND total>0 ORDER BY paid_at ASC NULLS LAST,id ASC LIMIT 1`);
    const invoice = first.rows[0]; if (!invoice || !invoice.paid_at || new Date(String(invoice.paid_at))<new Date(snapshot.assignedAt)) return;
    const base = Math.max(0,Number(invoice.total)-Number(invoice.tax ?? 0));
    const amount = (type:"fixed"|"percent", value:number) => Math.round((type==="percent" ? base*value/100 : value)*100)/100;
    if (snapshot.employeeRewardsEnabled && customer.acquiredByEmployeeId) {
      const reward = amount(snapshot.employeeRewardType,snapshot.employeeRewardValue);
      if (reward>0) await tx.execute(sql`INSERT INTO acquisition_rewards(tenant_id,customer_id,kind,recipient_user_id,invoice_id,amount,payroll_at)
        VALUES(${tenantId},${customer.id},'employee_bonus',${customer.acquiredByEmployeeId},${Number(invoice.id)},${reward},
        GREATEST(now(),COALESCE((SELECT MAX(((snapshot->>'dateTo')::date+1)::timestamp AT TIME ZONE COALESCE(snapshot->>'timezone','UTC'))
          FROM payroll_periods WHERE tenant_id=${tenantId}),now()))) ON CONFLICT DO NOTHING`);
    }
    if (snapshot.customerReferralsEnabled && customer.referringCustomerId && customer.referringCustomerId!==customer.id) {
      const reward = amount(snapshot.referralRewardType,snapshot.referralRewardValue);
      if (reward>0) {
        const [recipient]=await tx.select({id:customersTable.id}).from(customersTable).where(and(eq(customersTable.id,customer.referringCustomerId),eq(customersTable.tenantId,tenantId))).for("update");
        if(!recipient)return;
        const inserted = await tx.execute(sql`INSERT INTO acquisition_rewards(tenant_id,customer_id,kind,recipient_customer_id,invoice_id,amount)
          VALUES(${tenantId},${customer.id},'referral_credit',${customer.referringCustomerId},${Number(invoice.id)},${reward})
          ON CONFLICT DO NOTHING RETURNING id`);
        if (inserted.rows.length) {
          await tx.select({id:customersTable.id}).from(customersTable).where(and(eq(customersTable.id,customer.referringCustomerId),eq(customersTable.tenantId,tenantId))).for("update");
          await tx.insert(customerCreditsTable).values({tenantId,customerId:customer.referringCustomerId,amount:reward,kind:"referral_reward",
            requestId:randomUUID(),reference:`Referral reward for customer #${customer.id}, first paid invoice #${invoice.id}`});
        }
      }
    }
  });
}
// Qualifying payments are reconciled independently of whether someone opens a report.
const rewardTimer=setInterval(async()=>{
  try {
    const tenants=await db.select({id:tenantsTable.id}).from(tenantsTable);
    for(const tenant of tenants)await processAcquisitionRewards(tenant.id);
  }catch(error){logger.error({error},"Acquisition reward reconciliation failed; next cycle will retry without duplicating earned rewards");}
},60000);
rewardTimer.unref();
