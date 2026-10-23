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
  /** Stable identity for a finite plan visit, retained when its date changes. */
  planVisitIndex: integer("plan_visit_index"),
  planVisitGroupKey: text("plan_visit_group_key").notNull().default("main"),
  capacityOverrideReason: text("capacity_override_reason"),
  capacityOverrideBy: integer("capacity_override_by"),
  capacityOverrideAt: timestamp("capacity_override_at",{withTimezone:true}),
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
  /** Supplies the crew will need on site: [{inventoryItemId, name, quantity, unit}] */
  suppliesNeeded: jsonb("supplies_needed").default("[]"),
  /** Reminder tracking: {sent7d: boolean, sent24h: boolean, sentAt7d: string|null, sentAt24h: string|null} */
  remindersSent: jsonb("reminders_sent").default("{}"),
  /** When true, the scheduler sends an SMS reminder to the customer before this job. Staff opt-in per job at scheduling time. */
  smsReminderEnabled: boolean("sms_reminder_enabled").notNull().default(false),
  emailReminderEnabled: boolean("email_reminder_enabled").notNull().default(true),
  pushReminderEnabled: boolean("push_reminder_enabled").notNull().default(false),

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
  /**
   * Temporary claim lock set by the billing scheduler at the start of a transaction
   * to prevent concurrent processes from invoicing the same job twice.
   * Cleared once the real invoiceId is written. A non-null value older than ~5 minutes
   * indicates a crashed process and is reset by the stale-lock cleanup sweep.
   */
  invoiceClaimLockAt: timestamp("invoice_claim_lock_at", { withTimezone: true }),
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

  /**
   * Tracks how the job was created: "portal" = submitted by the customer via the portal,
   * "staff" = created internally. Null means legacy/pre-migration rows.
   */
  source: text("source"),

  /** Tags applied to this job — names drawn from the tenant's businessTagsTable library */
  tags: text("tags").array().default([]),
  /** FK to skip_reasons — set when the job occurrence was skipped with a reason */
  skipReasonId: integer("skip_reason_id"),
  /** Free-text note added alongside the skip reason */
  skipNote: text("skip_note"),

  // ── Off-season window (standalone recurring jobs) ─────────────────────────
  /** Off-season pause start in "MM-DD" format (e.g. "12-01"). Mirrors services.off_season_start. */
  offSeasonStart: text("off_season_start"),
  /** Off-season pause end in "MM-DD" format (e.g. "03-01"). */
  offSeasonEnd: text("off_season_end"),

  // ── Estimate link ────────────────────────────────────────────────────────────
  /** FK back to the estimate this job was converted from (set by POST /estimates/:id/convert). */
  estimateId: integer("estimate_id"),
  /**
   * When true, a draft invoice will be auto-created the moment this job is marked complete.
   * Set by the convert endpoint when staff choose "Invoice after job" during scheduling.
   */
  invoiceAfterJob: boolean("invoice_after_job").notNull().default(false),

  // ── Service timeline ──────────────────────────────────────────────────────
  /** Set when a technician marks the job as in_progress (clocks in). Null until then. */
  clockInAt: timestamp("clock_in_at", { withTimezone: true }),

  // ── Customer cancellation request ─────────────────────────────────────────
  /** Set when a customer submits a cancellation request via the portal (not yet cancelled — staff must confirm). */
  cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
  /** Optional reason the customer provided when requesting cancellation. */
  cancellationReason: text("cancellation_reason"),
  /** FK to an invoice created as a cancellation fee charge; set when a fee is auto-created on portal cancel. */
  cancellationChargeId: integer("cancellation_charge_id"),

  // ── Customer reschedule request ───────────────────────────────────────────
  /** Set when a customer submits a reschedule request via the portal. Staff must act on it. */
  rescheduleRequestedAt: timestamp("reschedule_requested_at", { withTimezone: true }),
  /** ISO date string (YYYY-MM-DD) of the customer's preferred new date, if they provided one. */
  reschedulePreferredDate: text("reschedule_preferred_date"),

  // ── Staff responses to cancel/reschedule requests ─────────────────────────
  /** 'pending' | 'approved' | 'declined' — set when staff respond to a cancel request. Null = no request. */
  cancelRequestStatus: text("cancel_request_status"),
  /** Optional reply message staff send when responding to a cancellation request. */
  cancelRequestReply: text("cancel_request_reply"),
  /** 'pending' | 'approved' | 'declined' — set when staff respond to a reschedule request. Null = no request. */
  rescheduleRequestStatus: text("reschedule_request_status"),
  /** Optional reply message staff send when responding to a reschedule request. */
  rescheduleRequestReply: text("reschedule_request_reply"),
  /** Soft archive timestamp. Customer archive cascades use the same timestamp as the customer. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
