import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
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
  /** Service catalog link — set on plan-generated visits (and optionally any job). */
  serviceId: integer("service_id"),
  /** Set when this job was auto-scheduled from a customer_plans row. */
  planId: integer("plan_id"),
  /** Required note when a single plan visit is cancelled (office must explain why). */
  cancelReason: text("cancel_reason"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  /** duration stored always in minutes; UI displays in hours or minutes per tenant setting */
  estimatedDuration: integer("estimated_duration"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalAmount: real("total_amount").notNull().default(0),
  /**
   * Line items array — same shape as estimates.lineItems (see JSDoc there):
   * [{id, serviceId?, description, qty, unitPrice, markup, discount, isOptional, optionalPitchLine?, acceptedByCustomer}]
   * CSV/XLSX import-export packs this into a single "Line Items" cell —
   * see the encodeLineItemsCell/decodeLineItemsCell convention in
   * artifacts/api-server/src/lib/importExport.ts.
   */
  lineItems: jsonb("line_items").default("[]"),
  /** parts used on this job: [{inventoryItemId, name, quantity, unitPrice, total}] */
  jobParts: jsonb("job_parts").default("[]"),
  /** Reminder tracking: {sent7d: boolean, sent24h: boolean, sentAt7d: string|null, sentAt24h: string|null} */
  remindersSent: jsonb("reminders_sent").default("{}"),
  /** When true, the scheduler sends an SMS reminder to the customer before this job. Staff opt-in per job at scheduling time. */
  smsReminderEnabled: boolean("sms_reminder_enabled").notNull().default(false),

  // ── Recurrence ────────────────────────────────────────────────────────────
  /**
   * JSONB recurrence rule. Present only on the series root (recurrenceParentId IS NULL).
   * Shape: { pattern, interval?, daysOfWeek?, dayOfMonth?, weekOfMonth?,
   *          endCondition, endAfter?, endDate? }
   */
  recurrenceRule: jsonb("recurrence_rule"),
  /** For generated instances: FK back to the series root job */
  recurrenceParentId: integer("recurrence_parent_id"),
  /** 0-based index of this occurrence within the series */
  recurrenceIndex: integer("recurrence_index"),
  /** When true the scheduler skips generating new instances until resumed */
  isRecurrencePaused: boolean("is_recurrence_paused").notNull().default(false),
  /** Number of occurrences already generated (only meaningful on the root) */
  recurrenceCount: integer("recurrence_count").notNull().default(0),
  /** Off-season pause: date the scheduler should auto-resume the series. Cleared once resumed. */
  resumeAt: timestamp("resume_at", { withTimezone: true }),

  // ── Non-recurring invoicing ───────────────────────────────────────────────
  /** Set true when this (non-recurring) job completed and is waiting to be swept into a weekly batch invoice. */
  pendingWeeklyInvoice: boolean("pending_weekly_invoice").notNull().default(false),
  /**
   * When true, this job is excluded from the next automatic overnight billing run
   * (processRecurringTemplates / generateDueTemplate).  Staff can set this flag
   * ahead of time from the job detail view or the billing preview dialog.
   * The flag is automatically cleared once the job is actually billed (invoiceId set).
   */
  holdFromBilling: boolean("hold_from_billing").notNull().default(false),

  // ── Routing (Divisions & Route Templates) ────────────────────────────────
  /** FK to route_templates — which recurring route slot this job belongs to */
  routeTemplateId: integer("route_template_id"),
  /** Stop order within its route/day, assigned by the sequencing engine */
  sequenceOrder: integer("sequence_order"),
  /** True when this occurrence was moved via "Reschedule This Week Only" */
  isOneTimeReschedule: integer("is_one_time_reschedule").notNull().default(0),
  /** The date this job would have been on before a one-time reschedule */
  originalScheduledDate: timestamp("original_scheduled_date", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
