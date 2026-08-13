import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { propertiesTable } from "./properties";
import { usersTable } from "./users";
import { estimateTemplatesTable } from "./estimateTemplates";

/**
 * Estimate line item shape stored in JSONB:
 * {
 *   id: string (uuid),
 *   serviceId?: number,
 *   description: string,
 *   qty: number,
 *   unitPrice: number,
 *   markup: number,        // percentage e.g. 20 = 20%
 *   discount: number,      // percentage e.g. 5 = 5%
 *   isOptional: boolean,
 *   optionalPitchLine?: string,
 *   acceptedByCustomer: boolean,
 * }
 *
 * CSV/XLSX import-export packs this array into a single "Line Items" cell —
 * see the encodeLineItemsCell/decodeLineItemsCell convention in
 * artifacts/api-server/src/lib/importExport.ts. jobs.lineItems shares this
 * same shape and convention.
 */

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  blueprintId: integer("blueprint_id"),
  templateId: integer("template_id").references(() => estimateTemplatesTable.id),
  assigneeId: integer("assignee_id").references(() => usersTable.id),
  /** Draft | Sent | Approved | Declined | Expired */
  status: text("status").notNull().default("draft"),
  /** scheduled | drop_by | drive_by */
  visitMode: text("visit_mode").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  notes: text("notes"),
  /** Line items array — see JSDoc above for shape */
  lineItems: jsonb("line_items").default("[]"),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  /** Signed token for public approval link */
  approvalToken: text("approval_token"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  /** Expected job duration in minutes, set by the estimator */
  estimatedDurationMin: integer("estimated_duration_min"),
  convertedToJobId: integer("converted_to_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimatesTable.$inferSelect;
