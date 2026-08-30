import { index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/** Stable audience-based conversations. Direct staff threads remain in staff_messages for compatibility. */
export const staffMessageConversationsTable = pgTable("staff_message_conversations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  audienceType: text("audience_type").notNull(),
  audienceId: integer("audience_id"),
  audienceKey: text("audience_key").notNull(),
  title: text("title").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("staff_message_conversations_tenant_audience_uidx").on(t.tenantId, t.audienceKey),
  index("staff_message_conversations_tenant_updated_idx").on(t.tenantId, t.updatedAt),
]);

export const staffMessagesTable = pgTable("staff_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  threadUserId: integer("thread_user_id").notNull().references(() => usersTable.id),
  conversationId: integer("conversation_id").references(() => staffMessageConversationsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  clientMessageId: text("client_message_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("staff_messages_tenant_thread_created_idx").on(t.tenantId, t.threadUserId, t.createdAt),
  index("staff_messages_tenant_thread_id_desc_idx").on(t.tenantId, t.threadUserId, t.id.desc()),
  index("staff_messages_tenant_conversation_id_desc_idx").on(t.tenantId, t.conversationId, t.id.desc()),
  index("staff_messages_tenant_sender_idx").on(t.tenantId, t.senderId),
  uniqueIndex("staff_messages_tenant_sender_client_uidx").on(t.tenantId, t.senderId, t.clientMessageId).where(sql`${t.clientMessageId} IS NOT NULL`),
]);

export const staffMessageReadsTable = pgTable("staff_message_reads", {
  messageId: integer("message_id").notNull().references(() => staffMessagesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.userId] }),
  index("staff_message_reads_user_idx").on(t.userId),
]);

export type StaffMessage = typeof staffMessagesTable.$inferSelect;
export type StaffMessageRead = typeof staffMessageReadsTable.$inferSelect;
export type StaffMessageConversation = typeof staffMessageConversationsTable.$inferSelect;