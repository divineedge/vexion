import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * A sellable service plan template (e.g. "12-Visit Lawn Program", "Quarterly Pest Control").
 * Defines which services are included, how often each recurs, how many visits
 * make up one period, the billing cycle, and the price.
 */
export const planTemplatesTable = pgTable("plan_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  /**
   * Services included with a frequency rule for each:
   * [{ serviceId, serviceName, frequencyDays }]
   * frequencyDays = days between visits of this service (e.g. 7 = weekly, 42 = every 6 weeks).
   */
  services: jsonb("services").notNull().default("[]"),
  /** Total visits included in one billing period, across all services combined. */
  visitCount: integer("visit_count").notNull().default(1),
  /** 'monthly' | 'quarterly' | 'annual' | 'custom' */
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  /** Number of days in one period when billingCycle === 'custom'. */
  customCycleDays: integer("custom_cycle_days"),
  /** Price charged per billing cycle. */
  price: real("price").notNull().default(0),
  /** Default for whether plans sold from this template auto-renew (can be overridden per plan). */
  autoRenewDefault: boolean("auto_renew_default").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanTemplateSchema = createInsertSchema(planTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlanTemplate = z.infer<typeof insertPlanTemplateSchema>;
export type PlanTemplate = typeof planTemplatesTable.$inferSelect;
