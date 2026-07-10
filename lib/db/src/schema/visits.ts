import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { propertiesTable } from "./properties";
import { usersTable } from "./users";

export const visitsTable = pgTable("visits", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  assigneeId: integer("assignee_id").references(() => usersTable.id),
  /** scheduled | drop_by | drive_by */
  visitMode: text("visit_mode").notNull().default("scheduled"),
  purpose: text("purpose").notNull(),
  notes: text("notes"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcomeNotes: text("outcome_notes"),
  convertedToEstimateId: integer("converted_to_estimate_id"),
  convertedToJobId: integer("converted_to_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVisitSchema = createInsertSchema(visitsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visitsTable.$inferSelect;
