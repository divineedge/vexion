import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const communicationsLogTable = pgTable("communications_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  /** 'inbound' | 'outbound' */
  direction: text("direction").notNull(),
  /** 'sms' | 'email' */
  channel: text("channel").notNull(),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  subject: text("subject"),
  body: text("body").notNull(),
  /** 'queued' | 'sent' | 'delivered' | 'failed' | 'received' */
  status: text("status").notNull().default("queued"),
  /** External message ID from the provider */
  externalId: text("external_id"),
  /** 'reminder_7d' | 'reminder_24h' | 'manual' | 'marketing' */
  messageType: text("message_type").notNull().default("manual"),
  /** Job this message is associated with, if any */
  jobId: integer("job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommunicationsLogSchema = createInsertSchema(communicationsLogTable).omit({ id: true, createdAt: true });
export type InsertCommunicationsLog = z.infer<typeof insertCommunicationsLogSchema>;
export type CommunicationsLog = typeof communicationsLogTable.$inferSelect;
