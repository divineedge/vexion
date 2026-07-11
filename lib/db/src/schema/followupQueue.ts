import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { usersTable } from "./users";

/**
 * Persistent "Smart Follow-Up Queue" items. Unlike a normal to-do, an item never
 * silently disappears — it stays open (and its displayed age keeps growing) until
 * an office user logs a communication note and resolves it. One open item is kept
 * per (tenantId, triggerType, triggerContextId); a still-pending trigger that fires
 * again (e.g. a repeat-reminder interval elapsing) bumps `lastRepeatedAt` on the
 * existing row instead of creating a duplicate.
 */
export const followupQueueItemsTable = pgTable("followup_queue_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  /** 'sent_estimate' | 'sent_invoice' | 'unanswered_email' | 'missed_call' | 'voicemail' */
  triggerType: text("trigger_type").notNull(),
  /** Id of the estimate/invoice/communications_log row that caused this item, for context lookups. */
  triggerContextId: integer("trigger_context_id"),
  /** Short human-readable reason shown in the queue list, e.g. "Estimate #123 sent 5 days ago, no response". */
  reason: text("reason").notNull(),
  /** 'open' | 'resolved' */
  status: text("status").notNull().default("open"),
  lastRepeatedAt: timestamp("last_repeated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  communicationNote: text("communication_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFollowupQueueItemSchema = createInsertSchema(followupQueueItemsTable).omit({ id: true, createdAt: true });
export type InsertFollowupQueueItem = z.infer<typeof insertFollowupQueueItemSchema>;
export type FollowupQueueItem = typeof followupQueueItemsTable.$inferSelect;
