import { describe,it,expect } from "vitest";
import { db,tenantsTable,usersTable,customersTable,invoicesTable,customerCreditsTable } from "@workspace/db";
import { eq,sql } from "drizzle-orm";
import { acquisitionSettings,processAcquisitionRewards,saveAcquisitionAttribution } from "./acquisitionRewards";
import { randomUUID } from "node:crypto";
describe("acquisition rewards",()=>{
 it("awards once after payment, with separate credit and employee earnings",async()=>{
  const rollback=new Error("Rollback isolated reward fixtures");
  try{await db.transaction(async tx=>{
   const [tenant]=await tx.insert(tenantsTable).values({name:`Reward test ${randomUUID()}`}).returning();
   const [user]=await tx.insert(usersTable).values({tenantId:tenant.id,name:"Test employee",email:`${randomUUID()}@example.invalid`,role:"technician"}).returning();
   const [referrer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:"Test referrer",email:"referrer@example.invalid",phone:"5550000001"}).returning();
   const [customer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:"Test lead",email:"lead@example.invalid",phone:"5550000002",referringCustomerId:referrer.id}).returning();
   const settings={...acquisitionSettings(null),employeeRewardsEnabled:true,employeeRewardType:"percent",employeeRewardValue:10,
     customerReferralsEnabled:true,referralRewardType:"fixed",referralRewardValue:20};
   await tx.execute(sql`UPDATE tenants SET acquisition_settings=${JSON.stringify(settings)}::jsonb WHERE id=${tenant.id}`);
   await saveAcquisitionAttribution(tenant.id,customer.id,{acquiredByEmployeeId:user.id},tx);
   const [invoice]=await tx.insert(invoicesTable).values({tenantId:tenant.id,customerId:customer.id,invoiceNumber:"TEST-REWARD",subtotal:100,tax:10,total:110,status:"sent"}).returning();
   await processAcquisitionRewards(tenant.id,tx);
   expect((await tx.execute(sql`SELECT * FROM acquisition_rewards WHERE tenant_id=${tenant.id}`)).rows).toHaveLength(0);
   await tx.update(invoicesTable).set({status:"paid",paidAt:new Date(Date.now()+20)}).where(eq(invoicesTable.id,invoice.id));
   for(let i=0;i<3;i++)await processAcquisitionRewards(tenant.id,tx);
   const rewards=await tx.execute(sql`SELECT kind,amount::float AS amount FROM acquisition_rewards WHERE tenant_id=${tenant.id} ORDER BY kind`);
   expect(rewards.rows).toEqual([{kind:"employee_bonus",amount:10},{kind:"referral_credit",amount:20}]);
   const credits=await tx.select().from(customerCreditsTable).where(eq(customerCreditsTable.tenantId,tenant.id));
   expect(credits).toHaveLength(1);expect(credits[0].customerId).toBe(referrer.id);expect(credits[0].kind).toBe("referral_reward");expect(credits[0].amount).toBe(20);
   await tx.insert(invoicesTable).values({tenantId:tenant.id,customerId:customer.id,invoiceNumber:"TEST-SECOND",subtotal:200,total:200,status:"paid",paidAt:new Date()});
   await processAcquisitionRewards(tenant.id,tx);
   expect((await tx.execute(sql`SELECT * FROM acquisition_rewards WHERE tenant_id=${tenant.id}`)).rows).toHaveLength(2);
   await expect(saveAcquisitionAttribution(tenant.id,customer.id,{acquiredByEmployeeId:null},tx)).rejects.toThrow("Paid customer");
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
 });
});
