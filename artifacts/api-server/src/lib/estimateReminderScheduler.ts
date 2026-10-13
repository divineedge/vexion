import {db,tenantsTable,estimatesTable,customersTable,documentReminderStepsTable,communicationsLogTable} from "@workspace/db";
import {and,eq,sql,isNull} from "drizzle-orm";
import {sendDocumentEmail} from "./documentDelivery";
import type {EmailProviderConfig} from "./emailProvider";
import {sendSms,type SmsProviderConfig} from "./smsProvider";
import {reminderActions,type ReminderActions} from "./documentReminderActions";
import {publicAppUrl} from "./publicSite";
import {logger} from "./logger";
export type EstimateReminderConfig={enabled:boolean;rules:ReminderActions[]};
export async function processEstimateReminders(tenant:typeof tenantsTable.$inferSelect){
  const config=tenant.estimateReminderSettings as EstimateReminderConfig|null;
  if(!config?.enabled)return;
  // Legacy sent estimates lack a trustworthy send date: activation starts a new reminder clock.
  await db.execute(sql`UPDATE estimates SET reminder_anchor_at=now() WHERE tenant_id=${tenant.id} AND status='sent' AND reminder_anchor_at IS NULL`);
  const rows=await db.select({estimate:estimatesTable,customer:customersTable}).from(estimatesTable).innerJoin(customersTable,and(eq(customersTable.id,estimatesTable.customerId),eq(customersTable.tenantId,tenant.id))).where(and(eq(estimatesTable.tenantId,tenant.id),eq(estimatesTable.status,"sent"),eq(estimatesTable.isArchived,false),isNull(customersTable.archivedAt)));
  for(const {estimate,customer} of rows){
    if(!estimate.reminderAnchorAt || (estimate.expiresAt && estimate.expiresAt<=new Date()))continue;
    const days=Math.floor((Date.now()-estimate.reminderAnchorAt.getTime())/86400000);
    // Don't send older stages in a burst after enabling or recovering a scheduler.
    const rule=[...config.rules].filter(r=>r.offsetDays<=days).sort((a,b)=>b.offsetDays-a.offsetDays)[0];
    if(!rule)continue;
    const link=`/estimates?estimateId=${estimate.id}`;
    const step=await reminderActions({tenantId:tenant.id,kind:"estimate",id:estimate.id,customerId:customer.id,customerName:customer.name,link},rule);
    const body=`Hi ${customer.name},\n\nA reminder to review your estimate #${estimate.id} from ${tenant.name}.\nYou can accept or decline it and tell us why in your customer portal:\n${publicAppUrl}/portal/estimates?tenant=${encodeURIComponent(tenant.slug??String(tenant.id))}\n\nThank you,\n${tenant.name}`;
    for(const channel of rule.channels??[]){
      const state=channel==="email"?step.emailState:step.smsState;
      if(state!=="pending" && state!=="failed")continue; // never automatically redeliver uncertain sends
      if(channel==="email" && (customer.emailOptOut || !customer.email))continue;
      if(channel==="sms" && (customer.smsOptOut || !customer.phone))continue;
      // Claim before external delivery. A process crash leaves uncertainty, not a repeat send.
      const claimed=await db.update(documentReminderStepsTable).set(channel==="email"?{emailState:"uncertain"}:{smsState:"uncertain"}).where(and(eq(documentReminderStepsTable.id,step.id),sql`${channel==="email"?documentReminderStepsTable.emailState:documentReminderStepsTable.smsState} IN ('pending','failed')`)).returning();
      if(!claimed.length)continue;
      const [fresh]=await db.select().from(estimatesTable).where(and(eq(estimatesTable.id,estimate.id),eq(estimatesTable.tenantId,tenant.id)));
      if(fresh?.status!=="sent" || (fresh.expiresAt && fresh.expiresAt<=new Date()))continue;
      try{
        if(channel==="email"){
          const result=await sendDocumentEmail({provider:tenant.emailProvider as EmailProviderConfig["provider"],config:tenant.emailProviderConfig as Record<string,string>??{},fromAddress:tenant.businessEmail??(tenant.emailProviderConfig as Record<string,string>)?.fromAddress??null},customer.email,`Estimate reminder — ${tenant.name}`,body,undefined,{tenantId:tenant.id,documentType:"estimate",documentId:estimate.id});
          await db.update(documentReminderStepsTable).set({emailState:result.success&&!result.devOnly?"accepted":result.devOnly||result.definitiveFailure?"failed":"uncertain",emailDeliveryId:result.deliveryId}).where(eq(documentReminderStepsTable.id,step.id));
        }else{
          if(!tenant.phonePlatform){await db.update(documentReminderStepsTable).set({smsState:"failed"}).where(eq(documentReminderStepsTable.id,step.id));continue;}
          const result=await sendSms({platform:tenant.phonePlatform as SmsProviderConfig["platform"],config:tenant.phonePlatformConfig as Record<string,string>??{},fromNumber:tenant.mainPhoneNumber},customer.phone,body);
          await db.insert(communicationsLogTable).values({tenantId:tenant.id,customerId:customer.id,direction:"outbound",channel:"sms",toAddress:customer.phone,body,status:result.success?"sent":"failed",externalId:result.externalId??null,messageType:"estimate_reminder"});
          await db.update(documentReminderStepsTable).set({smsState:result.success?"accepted":"uncertain"}).where(eq(documentReminderStepsTable.id,step.id));
        }
      }catch(error){logger.error({error,estimateId:estimate.id},"Estimate reminder requires delivery verification before retry");}
    }
  }
}
export function startEstimateReminderScheduler(){
  const run=async()=>{const tenants=await db.select().from(tenantsTable).where(sql`${tenantsTable.estimateReminderSettings}->>'enabled'='true'`);for(const tenant of tenants)try{await processEstimateReminders(tenant);}catch(error){logger.error({error,tenantId:tenant.id},"Estimate reminder scheduler");}};
  setTimeout(()=>void run().catch(error=>logger.error({error},"Estimate reminders")),30000);
  setInterval(()=>void run().catch(error=>logger.error({error},"Estimate reminders")),24*60*60*1000);
}
