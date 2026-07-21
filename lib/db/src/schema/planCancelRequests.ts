import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { customerPlansTable } from "./customerPlans";

/**
 * Cancellation request submitted by a customer through the portal.
 * Office staff review and approve (cancel the plan) or dismiss.
 * The plan is NOT immediately cancelled — it stays active until staff act.
 */
export const planCancelRequestsTable = pgTable("plan_cancel_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  planId: integer("plan_id").notNull().references(() => customerPlansTable.id),
  /** Optional reason provided by the customer */
  reason: text("reason"),
  /** 'pending' | 'approved' | 'dismissed' */
  status: text("status").notNull().default("pending"),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanCancelRequestSchema = createInsertSchema(planCancelRequestsTable).omit({ id: true, createdAt: true });
export type InsertPlanCancelRequest = z.infer<typeof insertPlanCancelRequestSchema>;
export type PlanCancelRequest = typeof planCancelRequestsTable.$inferSelect;
