import { pgTable, text, serial, timestamp, integer, real, jsonb, numeric, boolean } from "drizzle-orm/pg-core";
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
  declineReasonChoice: text("decline_reason_choice"),
  /** Expected job duration in minutes, set by the estimator */
  estimatedDurationMin: integer("estimated_duration_min"),
  /** Supplies the crew will need on site: [{inventoryItemId, name, quantity, unit}] */
  suppliesNeeded: jsonb("supplies_needed").default("[]"),
  convertedToJobId: integer("converted_to_job_id"),
  /** Payment requirement on acceptance: none | full | deposit_pct | deposit_fixed */
  paymentRequirement: text("payment_requirement").notNull().default("none"),
  /** For deposit_pct: percentage (e.g. 20 = 20%). For deposit_fixed: dollar amount. */
  depositValue: real("deposit_value"),
  /** Timestamp when the deposit/full payment was collected */
  depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
  /** Stripe PaymentIntent ID for the deposit charge */
  depositPaymentIntentId: text("deposit_payment_intent_id"),
  /** Exact dollar amount charged when depositPaidAt was set. Used to validate
   *  that the final approved total matches what was collected; immutable once set. */
  depositChargedAmount: real("deposit_charged_amount"),
  /** Soft archive state. Customer archive cascades use the same timestamp as the customer. */
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimatesTable.$inferSelect;
