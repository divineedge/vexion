import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { customersTable } from "./customers";
import { propertiesTable } from "./properties";

/** A staff-submitted request which does not become a scheduled job until reviewed. */
export const jobRequestsTable = pgTable("job_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  requesterId: integer("requester_id").notNull().references(() => usersTable.id),
  /** pending | clarification_requested | approved | rejected */
  status: text("status").notNull().default("pending"),
  customerId: integer("customer_id").references(() => customersTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  serviceId: integer("service_id"),
  requestedStartDate: timestamp("requested_start_date", { withTimezone: true }).notNull(),
  requestedEndDate: timestamp("requested_end_date", { withTimezone: true }),
  notes: text("notes"),
  adminResponse: text("admin_response"),
  reviewedById: integer("reviewed_by_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedJobId: integer("approved_job_id"),
  /** Generated once by the client and retained when it retries a submit. */
  idempotencyKey: text("idempotency_key").notNull(),
  amendmentIdempotencyKey: text("amendment_idempotency_key"),
  reviewIdempotencyKey: text("review_idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("job_requests_tenant_requester_idempotency_key_unique")
    .on(table.tenantId, table.requesterId, table.idempotencyKey),
  uniqueIndex("job_requests_tenant_review_idempotency_key_unique")
    .on(table.tenantId, table.reviewIdempotencyKey),
  uniqueIndex("job_requests_tenant_requester_amendment_idempotency_key_unique")
    .on(table.tenantId, table.requesterId, table.amendmentIdempotencyKey),
]);

export const insertJobRequestSchema = createInsertSchema(jobRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobRequest = z.infer<typeof insertJobRequestSchema>;
export type JobRequest = typeof jobRequestsTable.$inferSelect;