import {pgTable,serial,integer,text,boolean,timestamp,uniqueIndex} from "drizzle-orm/pg-core";
import {tenantsTable} from "./tenants";
export const documentReminderStepsTable=pgTable("document_reminder_steps",{
  id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
  documentType:text("document_type").notNull(),documentId:integer("document_id").notNull(),offsetDays:integer("offset_days").notNull(),
  alerted:boolean("alerted").notNull().default(false),taskCreated:boolean("task_created").notNull().default(false),
  emailState:text("email_state").notNull().default("pending"),emailDeliveryId:integer("email_delivery_id"),
  smsState:text("sms_state").notNull().default("pending"),
  createdAt:timestamp("created_at",{withTimezone:true}).defaultNow(),
},table=>[uniqueIndex("document_reminder_once").on(table.tenantId,table.documentType,table.documentId,table.offsetDays)]);
