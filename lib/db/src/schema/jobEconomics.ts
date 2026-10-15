import { pgTable, serial, integer, text, numeric, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { jobsTable } from "./jobs";
import { estimatesTable } from "./estimates";
import { expenseEntriesTable } from "./vendors";
import { usersTable } from "./users";

// Separate private tables: ordinary job/estimate responses must never expose
// frozen purchase costs or worker-rate assumptions to field/portal users.
export const jobReportBaselinesTable=pgTable("job_report_baselines",{
  jobId:integer("job_id").primaryKey().references(()=>jobsTable.id),
  tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
  baseline:jsonb("baseline").notNull(),
});
export const estimateReportBaselinesTable=pgTable("estimate_report_baselines",{
  estimateId:integer("estimate_id").primaryKey().references(()=>estimatesTable.id),
  tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
  baseline:jsonb("baseline").notNull(),
});
export const jobOtherCostsTable=pgTable("job_other_costs",{
  id:serial("id").primaryKey(),
  tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
  jobId:integer("job_id").notNull().references(()=>jobsTable.id),
  description:text("description").notNull(),
  amount:numeric("amount",{precision:14,scale:2}).notNull(),
  expenseId:integer("expense_id").references(()=>expenseEntriesTable.id),
  requestId:text("request_id").notNull(),
  requestFingerprint:text("request_fingerprint").notNull(),
  createdBy:integer("created_by").notNull().references(()=>usersTable.id),
  createdByName:text("created_by_name").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  voidedAt:timestamp("voided_at",{withTimezone:true}),
  voidedBy:integer("voided_by").references(()=>usersTable.id),
  voidReason:text("void_reason"),
},t=>[
  index("job_other_costs_job_idx").on(t.tenantId,t.jobId),
  uniqueIndex("job_other_costs_request_once").on(t.tenantId,t.requestId),
  check("job_other_costs_amount_check",sql`${t.amount}>0`),
]);
