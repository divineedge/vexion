import { pgTable, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Per-user dashboard layout. One row belongs to one staff user.
 * Company settings never read or write this table.
 */
export const userDashboardLayoutsTable = pgTable("user_dashboard_layouts", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  widgets: jsonb("widgets").notNull(),
  taskSources: jsonb("task_sources").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("user_dashboard_layouts_tenant_idx").on(table.tenantId),
]);

export type UserDashboardLayout = typeof userDashboardLayoutsTable.$inferSelect;
