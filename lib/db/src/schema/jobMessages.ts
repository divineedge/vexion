import { pgTable, text, serial, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/** Per-job staff message thread — staff-only, never exposed to the customer portal. */
export const jobMessagesTable = pgTable("job_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

export type JobMessage = typeof jobMessagesTable.$inferSelect;
export type JobMessageRead = typeof jobMessageReadsTable.$inferSelect;
