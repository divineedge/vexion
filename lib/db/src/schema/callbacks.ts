import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

export const callbacksTable = pgTable("callbacks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  // The completed job that caused the callback
  originalJobId: integer("original_job_id").notNull().references(() => jobsTable.id),
  // The technician who did the original job (denormalised for efficiency queries)
  originalAssigneeId: integer("original_assignee_id").references(() => usersTable.id),
  // Optional: a new job created to fix the issue
  callbackJobId: integer("callback_job_id").references(() => jobsTable.id),
  reason: text("reason"),
  resolutionNotes: text("resolution_notes"),
  // When the callback must be fixed by
  scheduledFixDate: timestamp("scheduled_fix_date", { withTimezone: true }),
  // open | resolved
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertCallbackSchema = createInsertSchema(callbacksTable).omit({ id: true, createdAt: true });
export type InsertCallback = z.infer<typeof insertCallbackSchema>;
export type Callback = typeof callbacksTable.$inferSelect;
