import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// ─── Bulk Messaging (Broadcasts) ────────────────────────────────────────────
// A single "blast" sent to a filtered segment of customers, respecting opt-outs.

export const broadcastsTable = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** 'sms' | 'email' */
  channel: text("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  /** Segment filter used to resolve recipients: { tag, city, state, customerType, lastServiceBefore, lastServiceAfter, campaignId, allCustomers } */
  recipientFilter: jsonb("recipient_filter").notNull().default("{}"),
  recipientCount: integer("recipient_count").notNull().default(0),
  /** 'draft' | 'sending' | 'completed' | 'failed' */
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  /** { sent, failed, optedOut } */
  stats: jsonb("stats").default('{"sent":0,"failed":0,"optedOut":0}'),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_broadcasts_tenant").on(t.tenantId),
]);

export const broadcastRecipientsTable = pgTable("broadcast_recipients", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  broadcastId: integer("broadcast_id").notNull().references(() => broadcastsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull(),
  /** 'sent' | 'failed' | 'skipped_opt_out' */
  status: text("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_broadcast_recipients_broadcast").on(t.broadcastId),
]);

export const insertBroadcastSchema = createInsertSchema(broadcastsTable).omit({ id: true, createdAt: true });
export const insertBroadcastRecipientSchema = createInsertSchema(broadcastRecipientsTable).omit({ id: true, createdAt: true });
export type InsertBroadcast = z.infer<typeof insertBroadcastSchema>;
export type InsertBroadcastRecipient = z.infer<typeof insertBroadcastRecipientSchema>;
export type Broadcast = typeof broadcastsTable.$inferSelect;
export type BroadcastRecipient = typeof broadcastRecipientsTable.$inferSelect;
