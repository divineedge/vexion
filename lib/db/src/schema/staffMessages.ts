import { index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/** General staff conversation messages, grouped by the staff member who owns the thread. */
export const staffMessagesTable = pgTable("staff_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  threadUserId: integer("thread_user_id").notNull().references(() => usersTable.id),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  clientMessageId: text("client_message_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("staff_messages_tenant_thread_created_idx").on(t.tenantId, t.threadUserId, t.createdAt),
  index("staff_messages_tenant_thread_id_desc_idx").on(t.tenantId, t.threadUserId, t.id.desc()),
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