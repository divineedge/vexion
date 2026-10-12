import { pgTable,serial,integer,text,timestamp,doublePrecision,numeric,jsonb,uniqueIndex,index,primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { customersTable } from "./customers";
import { jobsTable } from "./jobs";
import { invoicesTable } from "./invoices";
const at=(name:string)=>timestamp(name,{withTimezone:true});
export const doorHangerVisitsTable=pgTable("door_hanger_visits",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 jobId:integer("job_id").references(()=>jobsTable.id),employeeId:integer("employee_id").notNull().references(()=>usersTable.id),
 address:text("address").notNull(),lat:doublePrecision("lat"),lng:doublePrecision("lng"),
 completedAt:at("completed_at").notNull().defaultNow(),recordedBy:integer("recorded_by").notNull().references(()=>usersTable.id),
 convertedCustomerId:integer("converted_customer_id").references(()=>customersTable.id),
 createdAt:at("created_at").notNull().defaultNow(),shareToken:text("share_token").notNull().default(sql`gen_random_uuid()::text`)
},table=>[uniqueIndex("door_hanger_share_token").on(table.shareToken)]);
export const acquisitionRewardsTable=pgTable("acquisition_rewards",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 customerId:integer("customer_id").notNull().references(()=>customersTable.id),kind:text("kind").notNull(),
 recipientUserId:integer("recipient_user_id").references(()=>usersTable.id),
 recipientCustomerId:integer("recipient_customer_id").references(()=>customersTable.id),
 invoiceId:integer("invoice_id").notNull().references(()=>invoicesTable.id),amount:numeric("amount",{precision:14,scale:2}).notNull(),
 earnedAt:at("earned_at").notNull().defaultNow(),payrollAt:at("payroll_at").notNull().defaultNow()
},table=>[uniqueIndex("acquisition_rewards_tenant_id_customer_id_kind_key").on(table.tenantId,table.customerId,table.kind),
 index("acquisition_rewards_payroll").on(table.tenantId,table.recipientUserId,table.earnedAt)]);
export const publicQuoteRequestsTable=pgTable("public_quote_requests",{
 tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),requestId:text("request_id").notNull(),
 response:jsonb("response").notNull(),requestHash:text("request_hash"),createdAt:at("created_at").notNull().defaultNow()
},table=>[primaryKey({columns:[table.tenantId,table.requestId]})]);
export const documentDeliveriesTable=pgTable("document_deliveries",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 documentType:text("document_type").notNull(),documentId:integer("document_id").notNull(),channel:text("channel").notNull(),
 recipient:text("recipient").notNull(),subject:text("subject"),status:text("status").notNull().default("sending"),provider:text("provider"),
 providerMessageId:text("provider_message_id"),error:text("error"),openToken:text("open_token").notNull().unique(),
 openCount:integer("open_count").notNull().default(0),firstOpenedAt:at("first_opened_at"),lastOpenedAt:at("last_opened_at"),deliveredAt:at("delivered_at"),
 createdAt:at("created_at").notNull().defaultNow(),completedAt:at("completed_at"),providerReceipt:jsonb("provider_receipt"),providerCheckedAt:at("provider_checked_at")
},table=>[index("document_deliveries_history").on(table.tenantId,table.documentType,table.documentId,table.id)]);
export const documentDeliveryVerificationsTable=pgTable("document_delivery_verifications",{
 id:serial("id").primaryKey(),deliveryId:integer("delivery_id").notNull().references(()=>documentDeliveriesTable.id),
 tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),actorId:integer("actor_id").notNull().references(()=>usersTable.id),
 resolution:text("resolution").notNull(),evidence:text("evidence").notNull(),createdAt:at("created_at").notNull().defaultNow()
});
export const documentDeliveryOpensTable=pgTable("document_delivery_opens",{
 id:serial("id").primaryKey(),deliveryId:integer("delivery_id").notNull().references(()=>documentDeliveriesTable.id),openedAt:at("opened_at").notNull().defaultNow()
});
