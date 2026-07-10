import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// ── Equipment ─────────────────────────────────────────────────────────────────

export const equipmentTable = pgTable("equipment", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  /** mower | truck | trailer | sprayer | blower | edger | chainsaw | other */
  type: text("type").notNull().default("other"),
  purchaseDate: text("purchase_date"), // ISO date string YYYY-MM-DD
  purchasePrice: real("purchase_price").notNull().default(0),
  /** Expected lifespan in years (optional) */
  expectedLifespanYears: real("expected_lifespan_years"),
  /** Expected lifespan in hours (optional) */
  expectedLifespanHours: real("expected_lifespan_hours"),
  /** Current odometer in hours (primary tracking unit) */
  currentHours: real("current_hours").notNull().default(0),
  /** Current odometer in miles (for vehicles) */
  currentMiles: real("current_miles"),
  /** Running total of repair/maintenance costs — updated on each maintenance write */
  totalRepairCost: real("total_repair_cost").notNull().default(0),
  /** Running total of fuel costs — updated on each fuel log write */
  totalFuelCost: real("total_fuel_cost").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;

// ── Equipment Maintenance & Repair Log ────────────────────────────────────────

export const equipmentMaintenanceTable = pgTable("equipment_maintenance", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  description: text("description").notNull(),
  cost: real("cost").notNull().default(0),
  vendor: text("vendor"),
  /** Next service due date */
  nextServiceDueDate: text("next_service_due_date"),
  /** Next service due in hours */
  nextServiceDueHours: real("next_service_due_hours"),
  /** Next service due in miles */
  nextServiceDueMiles: real("next_service_due_miles"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEquipmentMaintenanceSchema = createInsertSchema(equipmentMaintenanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentMaintenance = z.infer<typeof insertEquipmentMaintenanceSchema>;
export type EquipmentMaintenance = typeof equipmentMaintenanceTable.$inferSelect;

// ── Equipment Fuel Logs ───────────────────────────────────────────────────────

export const equipmentFuelLogsTable = pgTable("equipment_fuel_logs", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  /** Gallons added */
  gallons: real("gallons").notNull(),
  /** Cost of this fill */
  cost: real("cost").notNull().default(0),
  /** Odometer reading at fill (hours for equipment, miles for vehicles) */
  odometerReading: real("odometer_reading"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEquipmentFuelLogSchema = createInsertSchema(equipmentFuelLogsTable).omit({ id: true, createdAt: true });
export type InsertEquipmentFuelLog = z.infer<typeof insertEquipmentFuelLogSchema>;
export type EquipmentFuelLog = typeof equipmentFuelLogsTable.$inferSelect;
