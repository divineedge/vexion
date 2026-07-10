import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { propertiesTable } from "./properties";
import { usersTable } from "./users";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("scheduled"),
  priority: text("priority").notNull().default("normal"),
  customerId: integer("customer_id").references(() => customersTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  assigneeId: integer("assignee_id").references(() => usersTable.id),
  /** crew assigned to this job (alternative to individual assignee) */
  crewId: integer("crew_id"),
  blueprintId: integer("blueprint_id"),
  invoiceId: integer("invoice_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  /** duration stored always in minutes; UI displays in hours or minutes per tenant setting */
  estimatedDuration: integer("estimated_duration"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalAmount: real("total_amount").notNull().default(0),
  lineItems: jsonb("line_items").default("[]"),
  /** parts used on this job: [{inventoryItemId, name, quantity, unitPrice, total}] */
  jobParts: jsonb("job_parts").default("[]"),
  /** Reminder tracking: {sent7d: boolean, sent24h: boolean, sentAt7d: string|null, sentAt24h: string|null} */
  remindersSent: jsonb("reminders_sent").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
