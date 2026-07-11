import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * A Division groups one or more crews into a routing unit with its own
 * depot (start/stop location) and shift-hour budget. Divisions are the
 * top-level grouping shown on the Routes Dashboard (e.g. "Mowing Crew 1").
 */
export const divisionsTable = pgTable("divisions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  /** Depot / start-stop location for route sequencing */
  depotLabel: text("depot_label"),
  depotLat: real("depot_lat"),
  depotLng: real("depot_lng"),
  /** Total shift hours available per route/day, used for the capacity meter */
  shiftHoursPerDay: real("shift_hours_per_day").notNull().default(8),
  /** Crews assigned to this division */
  crewIds: jsonb("crew_ids").default("[]"),
  /** Individual technicians assigned to this division (when not using a crew) */
  technicianIds: jsonb("technician_ids").default("[]"),
  isArchived: integer("is_archived").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDivisionSchema = createInsertSchema(divisionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDivision = z.infer<typeof insertDivisionSchema>;
export type Division = typeof divisionsTable.$inferSelect;

/**
 * A Route Template is a recurring routing slot within a division:
 * "every [frequency] on [dayOfWeek]". Jobs are assigned to a route
 * template + specific date; the template itself never moves.
 */
export const routeTemplatesTable = pgTable("route_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  divisionId: integer("division_id").notNull().references(() => divisionsTable.id),
  name: text("name").notNull(),
  /** weekly | biweekly_a | biweekly_b | monthly */
  frequency: text("frequency").notNull().default("weekly"),
  /** 0=Sunday .. 6=Saturday */
  dayOfWeek: integer("day_of_week").notNull().default(1),
  /** Per-route override of the tenant's default route exception trip charge */
  exceptionFeeOverride: real("exception_fee_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRouteTemplateSchema = createInsertSchema(routeTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRouteTemplate = z.infer<typeof insertRouteTemplateSchema>;
export type RouteTemplate = typeof routeTemplatesTable.$inferSelect;
