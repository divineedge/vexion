import { pgTable, serial, integer, text, timestamp, date, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { payrollPeriodsTable } from "./payroll";

export const p4pDamageReportsTable = pgTable("p4p_damage_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  payrollDate: date("payroll_date", { mode: "string" }).notNull(),
  jobId: integer("job_id"),
  allocations: jsonb("allocations").$type<Array<{ userId: number; employeeName: string; amount: number }>>().notNull(),
  status: text("status").notNull().default("pending"),
  createdBy: integer("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy: integer("approved_by"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  voidedBy: integer("voided_by"),
  voidedByName: text("voided_by_name"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  payrollPeriodId: integer("payroll_period_id").references(() => payrollPeriodsTable.id),
}, t => [index("p4p_damage_tenant_date").on(t.tenantId, t.payrollDate)]);
