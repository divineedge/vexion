import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { jobsTable } from "./jobs";

export const customerAlertsTable = pgTable("customer_alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  /** issue = problem found on site; upsell = recommended additional service */
  type: text("type").notNull().default("issue"),
  message: text("message").notNull(),
  /** pending = awaiting customer response; accepted; declined */
  status: text("status").notNull().default("pending"),
  customerResponse: text("customer_response"),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CustomerAlert = typeof customerAlertsTable.$inferSelect;
