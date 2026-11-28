import { pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { crewsTable } from "./crews";
import { jobsTable } from "./jobs";

/**
 * One driving leg on a crew's day: shop to the first stop, stop to stop,
 * or the last stop back to the shop. `toJobId` is null on the return leg.
 * `fromJobId` is null on the leg that leaves the shop.
 */
export const driveLegsTable = pgTable("drive_legs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  crewId: integer("crew_id").references(() => crewsTable.id, { onDelete: "cascade" }),
  routeDate: text("route_date").notNull(),
  sequence: integer("sequence").notNull(),
  fromJobId: integer("from_job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  toJobId: integer("to_job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  distanceMiles: real("distance_miles").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("drive_legs_crew_date_idx").on(table.tenantId, table.crewId, table.routeDate),
]);

export type DriveLeg = typeof driveLegsTable.$inferSelect;
