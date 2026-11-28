import { pgTable, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Per-user schedule forecast view. One row belongs to one staff user.
 * Company settings and the job schedule never read or write this table.
 */
export const userScheduleForecastViewsTable = pgTable("user_schedule_forecast_views", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  startHour: integer("start_hour").notNull().default(0),
  endHour: integer("end_hour").notNull().default(23),
  hourlyMinimized: boolean("hourly_minimized").notNull().default(false),
  minimizedDays: jsonb("minimized_days").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("user_schedule_forecast_views_tenant_idx").on(table.tenantId),
]);

export type UserScheduleForecastView = typeof userScheduleForecastViewsTable.$inferSelect;
