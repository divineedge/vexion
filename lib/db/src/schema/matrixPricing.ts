import { pgTable, text, serial, timestamp, integer, real, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { servicesTable } from "./services";

/** One matrix pricing document per service. Tiers live in matrix_tiers. */
export const matrixPricingRulesTable = pgTable("matrix_pricing_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  /** area | linear | both */
  basis: text("basis").notNull().default("area"),
  /** none | nearest_1 | nearest_5 | nearest_10 */
  priceRounding: text("price_rounding").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [unique("matrix_pricing_rules_service_unique").on(table.serviceId)]);

/** Unlimited measurement tiers for a matrix pricing rule. The last tier is open-ended (max_quantity null). */
export const matrixTiersTable = pgTable("matrix_tiers", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => matrixPricingRulesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  minQuantity: real("min_quantity").notNull(),
  maxQuantity: real("max_quantity"),
  /** flat | per_unit_above_base */
  calculationMode: text("calculation_mode").notNull().default("flat"),
  basePrice: real("base_price").notNull().default(0),
  unitRate: real("unit_rate"),
  perLinearFtRate: real("per_linear_ft_rate"),
  estimatedMinutes: integer("estimated_minutes"),
}, table => [unique("matrix_tiers_rule_position_unique").on(table.ruleId, table.position)]);
