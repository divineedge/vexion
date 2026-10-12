import { pgTable, text, serial, timestamp, integer, jsonb,boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Admin-defined custom form templates (e.g. "Performance Review", "Customer Complaint Intake").
 * Each template's `fields` describe a simple form schema the office can fill out; submissions
 * are stored as employeeHistoryEntries rows and never mutate the base users row.
 */
export const employeeFormTemplatesTable = pgTable("employee_form_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  /** [{ id, label, type: 'text'|'textarea'|'number'|'date'|'select', options?: string[] }] */
  fields: jsonb("fields").default("[]"),
  isActive: text("is_active_flag").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-employee history entries: reviews, complaints, callbacks, and custom-form submissions.
 * This is an append-only log kept separate from the users table — it never alters the
 * "original" employee record, only adds to the employee's file.
 */
export const employeeHistoryEntriesTable = pgTable("employee_history_entries", {
  sharedWithEmployee:boolean("shared_with_employee").notNull().default(false),
  occurredOn:text("occurred_on"),
  formSnapshot:jsonb("form_snapshot"),
  evidence:jsonb("evidence"),
  acknowledgedAt:timestamp("acknowledged_at",{withTimezone:true}),
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  /** 'review' | 'complaint' | 'callback' | 'custom_form' */
  type: text("type").notNull(),
  title: text("title").notNull(),
  /** Free-text body for review/complaint/callback entries. */
  notes: text("notes"),
  /** Set when type = 'custom_form': which template was used. */
  formTemplateId: integer("form_template_id").references(() => employeeFormTemplatesTable.id),
  /** Set when type = 'custom_form': the submitted field values, keyed by field id. */
  formData: jsonb("form_data").default("{}"),
  createdById: integer("created_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmployeeFormTemplateSchema = createInsertSchema(employeeFormTemplatesTable).omit({ id: true, createdAt: true });
export const insertEmployeeHistoryEntrySchema = createInsertSchema(employeeHistoryEntriesTable).omit({ id: true, createdAt: true });
export type InsertEmployeeFormTemplate = z.infer<typeof insertEmployeeFormTemplateSchema>;
export type InsertEmployeeHistoryEntry = z.infer<typeof insertEmployeeHistoryEntrySchema>;
export type EmployeeFormTemplate = typeof employeeFormTemplatesTable.$inferSelect;
export type EmployeeHistoryEntry = typeof employeeHistoryEntriesTable.$inferSelect;
