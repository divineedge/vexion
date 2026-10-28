import { frozenUserSlots } from "./softwareUserSlots";
import { randomUUID } from "node:crypto";
import { and,eq,sql,count,isNull } from "drizzle-orm";
import { db,operationsAlertsTable,usersTable,taskNotificationsTable,platformOwnersTable,companyExperienceTable,softwareBillingAccountsTable,plansTable,propertiesTable } from "@workspace/db";
import { logger } from "./logger";
import { ensureExperienceGuides } from "./experienceGuides";

export type ExperienceTx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function notifyExperience(tx:ExperienceTx,recipient:number,tenantId:number,message:string,linkPath:string){
  await tx.insert(taskNotificationsTable).values({tenantId,recipientUserId:recipient,type:"software_support",message,linkPath});
}
export async function recordOperationsAlert(id:string,tenantId:number|null,source:string,severity:string,message:string){
  await db.transaction(async tx=>{
    const [existing]=await tx.select().from(operationsAlertsTable).where(eq(operationsAlertsTable.id,id)).for("update");
    const inserted=await tx.insert(operationsAlertsTable).values({id,tenantId,source,severity,message}).onConflictDoNothing().returning({id:operationsAlertsTable.id});
    await tx.update(operationsAlertsTable).set({message,severity,resolved:false,updatedAt:new Date()}).where(eq(operationsAlertsTable.id,id));
    if(!inserted.length&&!existing?.resolved)return;
    const recipients=tenantId!==null
      ?await tx.select({id:usersTable.id,tenantId:usersTable.tenantId}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.isActive,true),sql`${usersTable.role} IN ('company_owner','office_manager','department_manager')`))
      :await tx.select({id:usersTable.id,tenantId:usersTable.tenantId}).from(usersTable).innerJoin(platformOwnersTable,eq(platformOwnersTable.userId,usersTable.id)).where(eq(usersTable.isActive,true));
    for(const person of recipients)await notifyExperience(tx,person.id,person.tenantId,message,tenantId===null?"/software-support":"/getting-started");
  });
}
export async function runOperationsChecks(tenantId?:number){
  // Fixed SQL/columns only. No provider mutation, secrets, customer names, or raw errors.
  const scope=tenantId===undefined?sql`TRUE`:sql`tenant_id=${tenantId}`;
  const candidates=[
    {source:"payouts",query:sql`SELECT tenant_id,count(*)::int n FROM platform_payment_allocations WHERE ${scope} AND (status='review' OR (last_error IS NOT NULL AND status NOT IN ('transferred','reversed'))) GROUP BY tenant_id`,label:"Business payouts need review"},
    {source:"billing_email",query:sql`SELECT tenant_id,count(*)::int n FROM billing_email_queue WHERE ${scope} AND status IN ('failed','interrupted') GROUP BY tenant_id`,label:"Billing email deliveries need review"},
    {source:"bank_returns",query:sql`SELECT tenant_id,count(*)::int n FROM invoice_card_attempts WHERE ${scope} AND status IN ('returned','disputed') GROUP BY tenant_id`,label:"Returned or disputed payments need review"},
  ];
  for(const check of candidates){
    try{
      const rows=(await db.execute(check.query)).rows as {tenant_id:number;n:number}[];
      const active=new Set(rows.map(r=>`${check.source}-${r.tenant_id}`));
      for(const row of rows)await recordOperationsAlert(`${check.source}-${row.tenant_id}`,row.tenant_id,check.source,"high",`${check.label}: ${row.n}.`);
      const old=await db.select().from(operationsAlertsTable).where(and(eq(operationsAlertsTable.source,check.source),tenantId===undefined?undefined:eq(operationsAlertsTable.tenantId,tenantId)));
      for(const alert of old)if(!active.has(alert.id)&&!alert.resolved)await db.update(operationsAlertsTable).set({resolved:true,updatedAt:new Date()}).where(eq(operationsAlertsTable.id,alert.id));
    }catch{await recordOperationsAlert(`monitor-${check.source}${tenantId===undefined?"":`-${tenantId}`}`,tenantId??null,"monitor","high",`The ${check.source.replace(/_/g," ")} health check could not complete. Status is unknown, not healthy.`);}
  }
}
let monitoringStarted=false;
export function startExperienceMonitoring(){if(monitoringStarted)return;monitoringStarted=true;let running=false;const run=async()=>{if(running)return;running=true;try{await ensureExperienceGuides();await runOperationsChecks();}catch{logger.warn("Operations health checks could not complete");}finally{running=false;}};void run();setInterval(()=>void run(),5*60000).unref();}

export class SoftwareCapacityError extends Error {status=409;}
/** Preserve historical access. Enforcement is explicit per company and only guards NEW capacity. */
export async function assertSoftwareCapacity(tx:ExperienceTx,tenantId:number,kind:"users"|"properties",additional=1){
  if(additional<=0)return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(426981,${tenantId})`);
  const [policy]=await tx.select().from(companyExperienceTable).where(eq(companyExperienceTable.tenantId,tenantId));
  const [seatAccount]=await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  const purchasedSlots=frozenUserSlots(seatAccount?.planPolicy);
  const paidSlotPlan=kind==="users" && purchasedSlots!==null;
  if(!policy?.subscriptionRequired&&!policy?.enforceLimits&&!paidSlotPlan)return;
  const [account]=await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,tenantId));
  const current=!!account?.stripeSubscriptionId&&["active","trialing"].includes(account.status);
  const trial=!!policy?.trialUntil&&policy.trialUntil>new Date();
  const anchor=account?.currentPeriodEnd??policy?.trialUntil??policy?.requiredSince;
  const grace=!!anchor&&Date.now()<=anchor.getTime()+(policy?.graceDays??7)*86400000;
  if(policy?.subscriptionRequired&&!current&&!trial&&!grace)throw new SoftwareCapacityError("A current software subscription is required to add users or properties. Historical records and existing work remain available. Open Software Billing.");
  if(!policy?.enforceLimits&&!paidSlotPlan)return;
  const [plan]=account?.planId?await tx.select().from(plansTable).where(eq(plansTable.id,account.planId)):[];
  const limit=kind==="users"
    ? purchasedSlots ? purchasedSlots.includedUsers===null?null:purchasedSlots.includedUsers+(account?.additionalUserSlots??0) : plan?.maxUsers
    :plan?.maxProperties;
  if(limit===null||limit===undefined)return;
  const [result]=kind==="users"
    ?await tx.select({n:count()}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.isActive,true)))
    :await tx.select({n:count()}).from(propertiesTable).where(and(eq(propertiesTable.tenantId,tenantId),isNull(propertiesTable.archivedAt)));
  if(Number(result.n)+additional>limit)throw new SoftwareCapacityError(`The software plan allows ${limit} active ${kind}. ${purchasedSlots?.extraUserPriceCents!=null?"Purchase extra user slots in Software Billing, or deactivate an unused account.":"Upgrade the plan or archive/deactivate an unused record before adding more."}`);
}
export async function withSoftwareCapacity<T>(tenantId:number,kind:"users"|"properties",write:(tx:ExperienceTx)=>Promise<T>,parent:typeof db|ExperienceTx=db,additional=1):Promise<T>{
  return parent.transaction(async(tx)=>{await assertSoftwareCapacity(tx,tenantId,kind,additional);return write(tx);});
}
export const newExperienceId=()=>randomUUID();
