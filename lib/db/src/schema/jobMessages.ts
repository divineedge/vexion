import { pgTable, text, serial, timestamp, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/** Per-job staff message thread — staff-only, never exposed to the customer portal. */
export const jobMessagesTable = pgTable("job_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  clientMessageId: text("client_message_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("job_messages_tenant_job_created_idx").on(t.tenantId, t.jobId, t.createdAt),
  index("job_messages_tenant_job_id_desc_idx").on(t.tenantId, t.jobId, t.id.desc()),
  uniqueIndex("job_messages_tenant_sender_client_uidx").on(t.tenantId, t.senderId, t.clientMessageId).where(sql`${t.clientMessageId} IS NOT NULL`),
]);

/**
 * Tracks which staff users have read which messages.
 * A row here means the user has seen that message.
 * Composite PK: each (messageId, userId) pair is unique.
 */
export const jobMessageReadsTable = pgTable(
  "job_message_reads",
  {
    messageId: integer("message_id").notNull().references(() => jobMessagesTable.id),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index("job_message_reads_user_message_idx").on(t.userId, t.messageId),
  ],
);

export type JobMessage = typeof jobMessagesTable.$inferSelect;
export type JobMessageRead = typeof jobMessageReadsTable.$inferSelect;
