import { pgTable, text, serial, timestamp, boolean, real, jsonb, integer } from "drizzle-orm/pg-core";
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
  /** Global master P4P payout percentage (0–100). Used when a service has no override. */
  p4pMasterPercentage: real("p4p_master_percentage").notNull().default(0),
  /** JSONB map of role → permission booleans, e.g. { crew_manager: { canCreateJobs: true, ... } } */
  rolePermissions: jsonb("role_permissions").default("{}"),
  logoUrl: text("logo_url"),
  customFields: jsonb("custom_fields").default("[]"),
  /** Equipment sell recommendation: flag when total repair cost exceeds this % of purchase price (default 50) */
  equipmentRepairThresholdPct: real("equipment_repair_threshold_pct").notNull().default(50),
  /** Equipment sell recommendation: flag when estimated resale value falls below this % of purchase price (default 20) */
  equipmentResaleThresholdPct: real("equipment_resale_threshold_pct").notNull().default(20),
  /** Geofence Defaults: radius in meters/feet applied when auto-creating a geofence on property add */
  defaultGeofenceRadius: integer("default_geofence_radius").notNull().default(100),
  /** Geofence unit: 'm' | 'ft' */
  defaultGeofenceUnit: text("default_geofence_unit").notNull().default("m"),
  /** Whether to auto-create a geofence when a property is added */
  autoCreateGeofence: boolean("auto_create_geofence").notNull().default(false),
  /** Default zone label presets shown in the measurement polygon tool */
  measurementZoneLabels: jsonb("measurement_zone_labels").default('["Front Lawn","Back Yard","Bed Areas","Side Yard","Common Area"]'),
  /** Preferred area unit for measurements: 'sqft' | 'acres' */
  preferredAreaUnit: text("preferred_area_unit").notNull().default("sqft"),
  // ── Communications ───────────────────────────────────────────────────────
  /** Phone number used for automated service reminders and transactional SMS */
  mainPhoneNumber: text("main_phone_number"),
  /** Phone number used for marketing/campaign SMS blasts */
  marketingPhoneNumber: text("marketing_phone_number"),
  /** SMS platform: 'openphone' | 'grasshopper' | 'twilio' | null */
  phonePlatform: text("phone_platform"),
  /** JSONB: platform-specific credentials/config (API keys etc.) */
  phonePlatformConfig: jsonb("phone_platform_config").default("{}"),
  /** Email sending provider: 'smtp' | 'sendgrid' | 'mailgun' | 'resend' | null */
  emailProvider: text("email_provider"),
  /** JSONB: provider-specific config (API key, from address, SMTP host etc.) */
  emailProviderConfig: jsonb("email_provider_config").default("{}"),
  // ── Integration Extensions ───────────────────────────────────────────────
  /**
   * JSONB map keyed by integration name ('bank' | 'mailchimp' | 'lob' | 'quickbooks').
   * Each value: { connected: boolean, connectedAt, lastSyncedAt, lastSyncStatus,
   * errorCount, encryptedConfig: string (AES-GCM ciphertext of the credentials) }.
   * Secrets are encrypted at rest via lib/secretsCrypto.ts and are never returned
   * in plaintext from the API — only masked placeholders are served to the client.
   */
  integrationsConfig: jsonb("integrations_config").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
