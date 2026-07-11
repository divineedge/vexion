import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { jobsTable } from "./jobs";
import { invoicesTable } from "./invoices";
import { estimatesTable } from "./estimates";

/**
 * A review request sent to a customer after an invoice is paid or an estimate
 * is approved/closed. Tracks the hosted review page lifecycle: rating capture,
 * structured "what went wrong" feedback for 1-4 star ratings, and whether the
 * customer was redirected to a public review site (5 stars only).
 */
export const reviewRequestsTable = pgTable("review_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  jobId: integer("job_id").references(() => jobsTable.id),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  estimateId: integer("estimate_id").references(() => estimatesTable.id),
  /** 'sms' | 'email' | 'both' */
  channel: text("channel").notNull().default("email"),
  /** Signed token used for the public, no-login review page */
  token: text("token").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  /** 1-5 once the customer submits a rating */
  rating: integer("rating"),
  /** Multi-select checklist for 1-4 star ratings, e.g. ["Communication","Pricing"] */
  checklistSelections: jsonb("checklist_selections"),
  /** "Tell us more" free text */
  feedbackText: text("feedback_text"),
  /** "What could we do differently to earn a 5-star experience?" free text */
  improvementText: text("improvement_text"),
  /** True once a 5-star customer has been shown/clicked the public redirect prompt */
  publicRedirected: boolean("public_redirected").notNull().default(false),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  /** Staff review workflow: 'new' | 'reviewed' | 'action_taken' | 'resolved' */
  reviewStatus: text("review_status").default("new"),
  reviewedBy: integer("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertReviewRequestSchema = createInsertSchema(reviewRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;
export type ReviewRequest = typeof reviewRequestsTable.$inferSelect;
