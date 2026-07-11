import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { invoicesTable } from "./invoices";

/**
 * Office approval queue item created when a recurring-job customer crosses the
 * tenant's configured stop-service overdue threshold. Nothing pauses
 * automatically — office must explicitly approve (pauses the recurring
 * series) or dismiss (keeps billing as-is) each flag.
 */
export const stopServiceFlagsTable = pgTable("stop_service_flags", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  daysOverdue: integer("days_overdue").notNull(),
  message: text("message").notNull(),
  /** 'pending' | 'approved' | 'dismissed' */
  status: text("status").notNull().default("pending"),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStopServiceFlagSchema = createInsertSchema(stopServiceFlagsTable).omit({ id: true, createdAt: true });
export type InsertStopServiceFlag = z.infer<typeof insertStopServiceFlagSchema>;
export type StopServiceFlag = typeof stopServiceFlagsTable.$inferSelect;
