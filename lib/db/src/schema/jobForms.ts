import { pgTable,serial,integer,text,boolean,jsonb,timestamp,uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
export const jobFormTemplatesTable=pgTable("job_form_templates",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 name:text("name").notNull(),description:text("description").notNull().default(""),
 fields:jsonb("fields").notNull().default([]),assignment:text("assignment").notNull().default("manual"),
 serviceIds:jsonb("service_ids").notNull().default([]),required:boolean("required").notNull().default(false),
 active:boolean("active").notNull().default(true),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow()
});
export const jobFormsTable=pgTable("job_forms",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 jobId:integer("job_id").notNull().references(()=>jobsTable.id),templateId:integer("template_id").notNull().references(()=>jobFormTemplatesTable.id),
 snapshot:jsonb("snapshot").notNull(),required:boolean("required").notNull().default(false),answers:jsonb("answers").notNull().default({}),
 submittedAt:timestamp("submitted_at",{withTimezone:true}),submittedBy:integer("submitted_by").references(()=>usersTable.id),
 updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow()
},table=>[uniqueIndex("job_forms_job_template").on(table.tenantId,table.jobId,table.templateId)]);
export const jobFormAuditTable=pgTable("job_form_audit",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 formId:integer("form_id").notNull().references(()=>jobFormsTable.id),actorId:integer("actor_id").notNull().references(()=>usersTable.id),
 event:text("event").notNull(),previous:jsonb("previous").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow()
});
