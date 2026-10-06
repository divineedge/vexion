import { pgTable, text, serial, timestamp, integer, real, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
import { crewsTable } from "./crews";

// ── Equipment ─────────────────────────────────────────────────────────────────

export const equipmentTable = pgTable("equipment", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** Optional direct employee assignment. May be set together with assignedCrewId. */
  assignedUserId: integer("assigned_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** Optional crew assignment. Field visibility is the union of direct and crew assignment. */
  assignedCrewId: integer("assigned_crew_id").references(() => crewsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** mower | truck | trailer | sprayer | blower | edger | chainsaw | other */
  type: text("type").notNull().default("other"),
  model: text("model"),
  serialNumber: text("serial_number"),
  year: integer("year"),
  attachmentType: text("attachment_type"),
  attachmentModel: text("attachment_model"),
  attachmentSerialNumber: text("attachment_serial_number"),
  attachmentYear: integer("attachment_year"),
  oilFilterNumber: text("oil_filter_number"),
  airFilterNumber: text("air_filter_number"),
  fuelFilterNumber: text("fuel_filter_number"),
  hydraulicFilterNumber: text("hydraulic_filter_number"),
  otherFilterNumbers: text("other_filter_numbers"),
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
  /** Set when equipment is archived (soft-deleted) instead of hard-deleted; preserves maintenance/fuel history. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  notes: text("notes"),
  /** Sell the unit when currentHours reaches this threshold (optional). Null = no threshold set. */
  sellAfterHours: real("sell_after_hours"),
  /** When true, the sell-recommendation logic is suppressed for this unit regardless of thresholds. */
  neverSell: boolean("never_sell").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  index("equipment_tenant_assigned_user_idx").on(table.tenantId, table.assignedUserId),
  index("equipment_tenant_assigned_crew_idx").on(table.tenantId, table.assignedCrewId),
]);

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
  /**
   * Split of `cost` into parts vs. labor, used by the Maintenance & Repair ledger.
   * Legacy records (from before this split existed) have both at 0 — the ledger
   * query falls back to treating the full `cost` as labor for those rows.
   */
  partsCost: real("parts_cost").notNull().default(0),
  laborCost: real("labor_cost").notNull().default(0),
  /** Hours the asset was out of service for this repair — feeds the downtime-value cost factor */
  downtimeHours: real("downtime_hours").notNull().default(0),
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
  /** Optional: job this fill was incurred on. When set, the profitability report attributes the cost directly to that job instead of splitting evenly. */
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  /** Gallons added */
  gallons: real("gallons").notNull(),
  /** Price per gallon at time of fill (informational; cost = gallons × costPerGallon when set) */
  costPerGallon: real("cost_per_gallon"),
  /** Total cost of this fill */
  cost: real("cost").notNull().default(0),
  /** purchased is the legacy/station source; bulk_tank is allocated from inventory. */
  fuelSource: text("fuel_source").notNull().default("purchased"),
  bulkFuelTankId: integer("bulk_fuel_tank_id"),
  /** Tank display label at dispense time; tank renames never rewrite this history. */
  bulkFuelTankName: text("bulk_fuel_tank_name"),
  /** Required by bulk dispensing and used to make retries replay-safe. */
  idempotencyKey: text("idempotency_key"),
  /** Odometer reading at fill (hours for equipment, miles for vehicles) */
  odometerReading: real("odometer_reading"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("equipment_fuel_logs_tenant_tank_idx").on(table.tenantId, table.bulkFuelTankId),
  uniqueIndex("equipment_fuel_logs_tenant_idempotency_uidx").on(table.tenantId, table.idempotencyKey),
]);

export const insertEquipmentFuelLogSchema = createInsertSchema(equipmentFuelLogsTable).omit({ id: true, createdAt: true });
export type InsertEquipmentFuelLog = z.infer<typeof insertEquipmentFuelLogSchema>;
export type EquipmentFuelLog = typeof equipmentFuelLogsTable.$inferSelect;

// ── Bulk fuel inventory ───────────────────────────────────────────────────────
// Inventory uses integer thousandths of a US gallon and integer cents.  The
// customer-facing API converts at its boundary; never derive current inventory
// from historical floating point fuel log values.
export const bulkFuelTanksTable = pgTable("bulk_fuel_tanks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fuelType: text("fuel_type").notNull(),
  capacityThousandths: integer("capacity_thousandths"),
  availableThousandths: integer("available_thousandths").notNull().default(0),
  inventoryValueCents: integer("inventory_value_cents").notNull().default(0),
  meterThousandths: integer("meter_thousandths"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("bulk_fuel_tanks_tenant_active_idx").on(table.tenantId, table.isActive),
]);

export const bulkFuelTransactionsTable = pgTable("bulk_fuel_transactions", {
  id: serial("id").primaryKey(),
  tankId: integer("tank_id").notNull().references(() => bulkFuelTanksTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** delivery | opening_balance | dispense | reversal | adjustment */
  type: text("type").notNull(),
  date: text("date").notNull(),
  gallonsThousandths: integer("gallons_thousandths").notNull(),
  totalCostCents: integer("total_cost_cents").notNull(),
  supplier: text("supplier"),
  reference: text("reference"),
  notes: text("notes"),
  reason: text("reason"),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  beforeThousandths: integer("before_thousandths"),
  afterThousandths: integer("after_thousandths"),
  beforeValueCents: integer("before_value_cents"),
  afterValueCents: integer("after_value_cents"),
  expectedMovementId: integer("expected_movement_id"),
  meterBeforeThousandths: integer("meter_before_thousandths"),
  meterAfterThousandths: integer("meter_after_thousandths"),
  equipmentId: integer("equipment_id").references(() => equipmentTable.id, { onDelete: "set null" }),
  /** Equipment label at movement time; retained even after an equipment rename. */
  equipmentName: text("equipment_name"),
  fuelLogId: integer("fuel_log_id").references(() => equipmentFuelLogsTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("bulk_fuel_transactions_tank_created_idx").on(table.tankId, table.createdAt),
  index("bulk_fuel_transactions_tenant_date_idx").on(table.tenantId, table.date),
  uniqueIndex("bulk_fuel_transactions_tank_idempotency_uidx").on(table.tankId, table.idempotencyKey),
  uniqueIndex("bulk_fuel_transactions_fuel_log_type_uidx").on(table.fuelLogId, table.type),
]);

export type BulkFuelTank = typeof bulkFuelTanksTable.$inferSelect;
export type BulkFuelTransaction = typeof bulkFuelTransactionsTable.$inferSelect;

// ── Equipment Reading Logs (hour-meter / mileage history) ────────────────────
// Historical ledger of hour-meter and mileage readings, primarily populated by
// Daily Task Manager task items (hour_meter_log / mileage_log) linked to an asset.
// Used to compute runtime-hours run within a date range for the operating cost ledger.

export const equipmentReadingLogsTable = pgTable("equipment_reading_logs", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  /** hours | mileage */
  readingType: text("reading_type").notNull(),
  value: real("value").notNull(),
  /** task_bundle | manual */
  source: text("source").notNull().default("manual"),
  taskBundleCompletionId: integer("task_bundle_completion_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEquipmentReadingLogSchema = createInsertSchema(equipmentReadingLogsTable).omit({ id: true, createdAt: true });
export type InsertEquipmentReadingLog = z.infer<typeof insertEquipmentReadingLogSchema>;
export type EquipmentReadingLog = typeof equipmentReadingLogsTable.$inferSelect;

// ── Tenant Equipment Types ────────────────────────────────────────────────────
// Per-tenant list of equipment type labels. Replaces the hardcoded frontend
// constant; defaults are seeded on tenant creation.

export const tenantEquipmentTypesTable = pgTable("tenant_equipment_types", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantEquipmentTypeSchema = createInsertSchema(tenantEquipmentTypesTable).omit({ id: true, createdAt: true });
export type InsertTenantEquipmentType = z.infer<typeof insertTenantEquipmentTypeSchema>;
export type TenantEquipmentType = typeof tenantEquipmentTypesTable.$inferSelect;

// ── Equipment Lifecycle Events (archive / restore audit trail) ────────────────

export const equipmentLifecycleEventsTable = pgTable("equipment_lifecycle_events", {
  id: serial("id").primaryKey(),
  equipmentId: integer("equipment_id").notNull().references(() => equipmentTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** "archived" | "restored" */
  eventType: text("event_type").notNull(),
  performedByUserId: integer("performed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  performedByName: text("performed_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEquipmentLifecycleEventSchema = createInsertSchema(equipmentLifecycleEventsTable).omit({ id: true, createdAt: true });
export type InsertEquipmentLifecycleEvent = z.infer<typeof insertEquipmentLifecycleEventSchema>;
export type EquipmentLifecycleEvent = typeof equipmentLifecycleEventsTable.$inferSelect;
