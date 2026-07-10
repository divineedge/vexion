import { pgTable, text, serial, timestamp, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  planTier: text("plan_tier").notNull().default("starter"),
  stripeEnabled: boolean("stripe_enabled").notNull().default(false),
  quickbooksEnabled: boolean("quickbooks_enabled").notNull().default(false),
  timezone: text("timezone").notNull().default("America/New_York"),
  workdayCutoffTime: text("workday_cutoff_time").notNull().default("18:00"),
  overageMaterialBuffer: real("overage_material_buffer").notNull().default(10),
  taxRate: real("tax_rate").notNull().default(8.5),
  defaultMarkupPct: real("default_markup_pct").notNull().default(20),
  showCostPriceToTech: boolean("show_cost_price_to_tech").notNull().default(false),
  /** 'minutes' | 'hours' — controls how job duration is displayed/entered company-wide */
  durationUnit: text("duration_unit").notNull().default("minutes"),
  /** auto-invoicing: 'off' | 'daily' | 'weekly' | 'monthly' */
  autoInvoiceFrequency: text("auto_invoice_frequency").notNull().default("off"),
  /** JSONB map of role → permission booleans, e.g. { crew_manager: { canCreateJobs: true, ... } } */
  rolePermissions: jsonb("role_permissions").default("{}"),
  logoUrl: text("logo_url"),
  customFields: jsonb("custom_fields").default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
