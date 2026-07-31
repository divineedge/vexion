import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * Tenant-configured reasons for skipping a job occurrence.
 *
 * Each reason can carry an automatic action that fires when the reason is used:
 *   none            — record only
 *   notify_customer — send the customer an SMS
 *   flag_property   — add a customer alert note on the job's property
 *   create_task     — open an internal office task linked to the job
 */
export const skipReasonsTable = pgTable("skip_reasons", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  label: text("label").notNull(),
  /**
   * What should automatically happen when this reason is selected:
   *   none | notify_customer | flag_property | create_task
   */
  action: text("action").notNull().default("none"),
  /**
   * Optional action config (jsonb):
   *   notify_customer: { messageTemplate?: string }
   *   flag_property:   { note?: string }
   *   create_task:     { title?: string, priority?: string }
   */
  actionConfig: jsonb("action_config").default("{}"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSkipReasonSchema = createInsertSchema(skipReasonsTable).omit({ id: true, createdAt: true });
export type InsertSkipReason = z.infer<typeof insertSkipReasonSchema>;
export type SkipReason = typeof skipReasonsTable.$inferSelect;
