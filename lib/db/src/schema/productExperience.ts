import { pgTable, text, integer, timestamp, boolean, jsonb,index,uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";

export const supportThreadsTable = pgTable("support_threads", {
  id: text("id").primaryKey(), tenantId: integer("tenant_id").notNull().references(()=>tenantsTable.id),
  userId: integer("user_id").notNull().references(()=>usersTable.id),
  kind:text("kind").notNull(), title:text("title").notNull(), status:text("status").notNull().default("received"),
  priority:text("priority").notNull().default("normal"), assigneeId:integer("assignee_id").references(()=>usersTable.id),
  duplicateOf:text("duplicate_of"), diagnostics:jsonb("diagnostics").notNull().default({}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(), updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("support_threads_user_updated_idx").on(t.userId,t.updatedAt)]);
export const supportMessagesTable = pgTable("support_messages", {
  id:text("id").primaryKey(), threadId:text("thread_id").notNull().references(()=>supportThreadsTable.id),
  userId:integer("user_id").notNull().references(()=>usersTable.id), body:text("body").notNull(),
  internal:boolean("internal").notNull().default(false), attachments:jsonb("attachments").notNull().default([]),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("support_messages_thread_idx").on(t.threadId,t.createdAt)]);
export const supportUploadsTable = pgTable("support_uploads", {
  id:text("id").primaryKey(), userId:integer("user_id").notNull().references(()=>usersTable.id),
  tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id), objectPath:text("object_path").notNull(),
  name:text("name").notNull(), contentType:text("content_type").notNull(), size:integer("size").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("support_uploads_user_created_idx").on(t.userId,t.createdAt)]);
export const productContentTable = pgTable("product_content", {
  id:text("id").primaryKey(), kind:text("kind").notNull(), title:text("title").notNull(), body:text("body").notNull(),
  published:boolean("published").notNull().default(false), updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const companyExperienceTable = pgTable("company_experience", {
  tenantId:integer("tenant_id").primaryKey().references(()=>tenantsTable.id),
  completedSteps:jsonb("completed_steps").notNull().default([]), subscriptionRequired:boolean("subscription_required").notNull().default(false),
  requiredSince:timestamp("required_since",{withTimezone:true}), trialUntil:timestamp("trial_until",{withTimezone:true}),
  graceDays:integer("grace_days").notNull().default(7), enforceLimits:boolean("enforce_limits").notNull().default(false),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const operationsAlertsTable = pgTable("operations_alerts", {
  id:text("id").primaryKey(), tenantId:integer("tenant_id").references(()=>tenantsTable.id),
  source:text("source").notNull(), severity:text("severity").notNull(), message:text("message").notNull(),
  resolved:boolean("resolved").notNull().default(false), createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const recoveryDrillsTable = pgTable("recovery_drills", {
  id:text("id").primaryKey(), userId:integer("user_id").notNull().references(()=>usersTable.id),
  environment:text("environment").notNull(), evidence:text("evidence").notNull(), passed:boolean("passed").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const accountSecurityTable = pgTable("account_security", {
  userId:integer("user_id").primaryKey().references(()=>usersTable.id),
  enabled:boolean("enabled").notNull().default(false), encryptedSecret:text("encrypted_secret"),
  pendingSecret:text("pending_secret"), pendingExpires:timestamp("pending_expires",{withTimezone:true}),
  recoveryHashes:jsonb("recovery_hashes").notNull().default([]), lastStep:integer("last_step"),
  failures:integer("failures").notNull().default(0), blockedUntil:timestamp("blocked_until",{withTimezone:true}),
  resetHash:text("reset_hash"), resetExpires:timestamp("reset_expires",{withTimezone:true}),
},t=>[uniqueIndex("account_security_reset_hash_idx").on(t.resetHash)]);
export const reviewPhotosTable=pgTable("review_photos",{
  id:text("id").primaryKey(), reviewId:integer("review_id").notNull(), tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
  objectPath:text("object_path").notNull(), name:text("name").notNull(), contentType:text("content_type").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("review_photos_review_idx").on(t.reviewId)]);
export const insertSupportThreadSchema=createInsertSchema(supportThreadsTable);
export const insertSupportMessageSchema=createInsertSchema(supportMessagesTable);
export const insertProductContentSchema=createInsertSchema(productContentTable);
export const insertCompanyExperienceSchema=createInsertSchema(companyExperienceTable);
