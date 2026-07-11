import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { invoicesTable } from "./invoices";

export const billingEmailQueueTable = pgTable("billing_email_queue", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  /** 'pending' | 'sent' | 'failed' */
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBillingEmailQueueSchema = createInsertSchema(billingEmailQueueTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBillingEmailQueue = z.infer<typeof insertBillingEmailQueueSchema>;
export type BillingEmailQueue = typeof billingEmailQueueTable.$inferSelect;
