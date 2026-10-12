import { pgTable, serial, integer, text, timestamp, jsonb, real, numeric, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// Append-only rate versions. Null is meaningful: inherit the next P4P default,
// or an unconfigured hourly guarantee.
export const payrollRatesTable = pgTable("payroll_rates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  source: text("source").notNull(),
  sourceId: integer("source_id").notNull(),
  value: real("value"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
}, t => [index("payroll_rates_lookup").on(t.tenantId, t.source, t.sourceId, t.effectiveAt)]);

export const payrollPeriodsTable = pgTable("payroll_periods", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  rangeStart: timestamp("range_start", { withTimezone: true }).notNull(),
  rangeEnd: timestamp("range_end", { withTimezone: true }).notNull(),
  approvedBy: integer("approved_by").notNull(),
  approvedByName: text("approved_by_name").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb("snapshot").notNull(),
});

export const payrollAdjustmentsTable = pgTable("payroll_adjustments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  periodId: integer("period_id").notNull().references(() => payrollPeriodsTable.id),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  createdBy: integer("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
