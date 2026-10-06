import { pgTable, text, serial, timestamp, boolean, real, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** URL-safe slug used in the customer portal link, e.g. "divine-edge" → /portal/?tenant=divine-edge */
  slug: text("slug").unique(),
  planTier: text("plan_tier").notNull().default("starter"),
  stripeEnabled: boolean("stripe_enabled").notNull().default(false),
  quickbooksEnabled: boolean("quickbooks_enabled").notNull().default(false),
  timezone: text("timezone").notNull().default("America/New_York"),
  workdayCutoffTime: text("workday_cutoff_time").notNull().default("18:00"),
  overageMaterialBuffer: real("overage_material_buffer").notNull().default(10),
  taxRate: real("tax_rate").notNull().default(8.5),
  defaultMarkupPct: real("default_markup_pct").notNull().default(20),
  showCostPriceToTech: boolean("show_cost_price_to_tech").notNull().default(false),
  /** Allow company owners to be scheduled individually and added to field crews. */
  ownersSchedulable: boolean("owners_schedulable").notNull().default(false),
  /** 'minutes' | 'hours' — controls how job duration is displayed/entered company-wide */
  durationUnit: text("duration_unit").notNull().default("minutes"),
  /** auto-invoicing: 'off' | 'daily' | 'weekly' | 'bi_monthly' | 'monthly' */
  autoInvoiceFrequency: text("auto_invoice_frequency").notNull().default("off"),
  /** Global master P4P payout percentage (0–100). Used when a service has no override. */
  p4pMasterPercentage: real("p4p_master_percentage").notNull().default(0),
  /** JSONB map of role → permission booleans, e.g. { crew_manager: { canCreateJobs: true, ... } } */
  rolePermissions: jsonb("role_permissions").default("{}"),
  logoUrl: text("logo_url"),
  customFields: jsonb("custom_fields").default("[]"),
  /** Tenant-configured required fields for new chemical application records. */
  chemicalRecordRequirements: jsonb("chemical_record_requirements").default(
    '{"treatedArea":false,"treatedZoneName":false,"targetPest":false,"applicationMethod":false,"windSpeed":false,"windDirection":false,"temperature":false,"applicatorName":false,"applicatorLicenseNumber":false,"notes":false}',
  ),
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
  /** Default annual pause window for newly-created recurring jobs, in MM-DD format. */
  defaultOffSeasonStart: text("default_off_season_start"),
  defaultOffSeasonEnd: text("default_off_season_end"),
  /** @deprecated use measurementZoneTypes instead — kept for backward-compat migration */
  measurementZoneLabels: jsonb("measurement_zone_labels").default('["Front Lawn","Back Yard","Bed Areas","Side Yard","Common Area"]'),
  /**
   * Structured zone type definitions: Array<{ id: string, name: string, color: string, mode?: 'area' | 'linear' }>.
   * `mode` defaults to 'area' (closed polygon, e.g. lawns/beds) when absent; 'linear' zone types (e.g. Fence
   * Line) are drawn as an open polyline and measured in feet instead of sqft. New tenants get a linear
   * "Fence Line" example type out of the box so the feature is discoverable.
   */
  measurementZoneTypes: jsonb("measurement_zone_types").default(
    '[{"id":"1","name":"Front Lawn","color":"#3B82F6","mode":"area"},{"id":"2","name":"Back Yard","color":"#10B981","mode":"area"},{"id":"3","name":"Bed Areas","color":"#F59E0B","mode":"area"},{"id":"4","name":"Side Yard","color":"#EF4444","mode":"area"},{"id":"5","name":"Common Area","color":"#8B5CF6","mode":"area"},{"id":"6","name":"Fence Line","color":"#06B6D4","mode":"linear"}]'
  ),
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
  /** Email sending provider: 'smtp' | 'sendgrid' | 'mailgun' | 'resend' | 'gmail' | null */
  emailProvider: text("email_provider"),
  /**
   * JSONB: provider-specific config (API key, from address, SMTP host etc.).
   * For 'gmail': { gmailEmail: string (connected account), gmailRefreshToken: string,
   * gmailOAuthNonce/gmailOAuthNonceExpiresAt/gmailOAuthUserId: transient CSRF binding for the
   * in-flight OAuth authorization-code request, cleared once the callback consumes it }.
   */
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
  // ── Business Profile (shown on estimates/invoices & pre-fills "From" comms) ─
  businessPhone: text("business_phone"),
  businessEmail: text("business_email"),
  businessWebsite: text("business_website"),
  /** Physical office street address. Kept in businessAddress for backwards-compatible document rendering. */
  businessAddress: text("business_address"),
  businessCity: text("business_city"),
  businessState: text("business_state"),
  businessZip: text("business_zip"),
  businessLat: real("business_lat"),
  businessLng: real("business_lng"),
  businessMailingSameAsPhysical: boolean("business_mailing_same_as_physical").notNull().default(true),
  businessMailingAddress: text("business_mailing_address"),
  businessMailingCity: text("business_mailing_city"),
  businessMailingState: text("business_mailing_state"),
  businessMailingZip: text("business_mailing_zip"),
  businessLicenseNumber: text("business_license_number"),
  businessTagline: text("business_tagline"),
  /** Shown at the bottom of every estimate/invoice, e.g. "Payment due within 30 days." */
  invoiceFooterText: text("invoice_footer_text"),
  // ── Payment Reminders & Stop-Service Rule ────────────────────────────────
  paymentRemindersEnabled: boolean("payment_reminders_enabled").notNull().default(false),
  /**
   * Array of { offsetDays: number, label: string, channels?: ('sms'|'email')[] }.
   * Negative = before due date, positive = overdue. `channels` is per-rule; rules
   * created before the per-rule channel feature omit it and fall back to the
   * legacy tenant-wide `paymentReminderChannels` default at send time.
   */
  paymentReminderSchedule: jsonb("payment_reminder_schedule").default(
    '[{"offsetDays":-3,"label":"3 days before due","channels":["email"]},{"offsetDays":0,"label":"On due date","channels":["email"]},{"offsetDays":7,"label":"7 days overdue","channels":["email"]},{"offsetDays":14,"label":"14 days overdue","channels":["email"]}]',
  ),
  /** Legacy tenant-wide default, array of 'sms' | 'email'. Kept as the fallback for reminder rules that predate per-rule channels. */
  paymentReminderChannels: jsonb("payment_reminder_channels").default('["email"]'),
  /** Off by default — flags recurring customers for office review instead of auto-pausing */
  stopServiceRuleEnabled: boolean("stop_service_rule_enabled").notNull().default(false),
  stopServiceThresholdDays: integer("stop_service_threshold_days").notNull().default(30),
  // ── Review Collection ─────────────────────────────────────────────────────
  reviewRequestOnInvoicePaid: boolean("review_request_on_invoice_paid").notNull().default(true),
  reviewRequestOnEstimateApproved: boolean("review_request_on_estimate_approved").notNull().default(false),
  reviewGoogleUrl: text("review_google_url"),
  reviewFacebookUrl: text("review_facebook_url"),
  reviewCustomLink1Label: text("review_custom_link1_label"),
  reviewCustomLink1Url: text("review_custom_link1_url"),
  reviewCustomLink2Label: text("review_custom_link2_label"),
  reviewCustomLink2Url: text("review_custom_link2_url"),
  // ── Smart Follow-Up Queue automation triggers ────────────────────────────
  /**
   * Shape: {
   *   sentEstimate: { enabled: boolean, delayDays: number, repeatDays: number },
   *   sentInvoice: { enabled: boolean, delayDays: number, repeatDays: number },
   *   unansweredEmail: { enabled: boolean, hours: number },
   *   missedCall: { enabled: boolean },
   * }
   */
  followupTriggerConfig: jsonb("followup_trigger_config").default(
    '{"sentEstimate":{"enabled":true,"delayDays":3,"repeatDays":3},"sentInvoice":{"enabled":true,"delayDays":5,"repeatDays":5},"unansweredEmail":{"enabled":true,"hours":48},"missedCall":{"enabled":true}}',
  ),
  // ── Routing ───────────────────────────────────────────────────────────────
  /** Trip charge auto-appended to a job's invoice when it uses a one-time reschedule */
  routeExceptionFee: real("route_exception_fee").notNull().default(0),
  /** Editable pre-trip questions. Shape: Array<{id,label,required,equipmentTypes?: string[]}>; missing/empty equipmentTypes applies to all. */
  preTripChecklistName: text("pre_trip_checklist_name").notNull().default("Pre-trip"),
  preTripChecklist: jsonb("pre_trip_checklist").default(
    '[{"id":"tires","label":"Tires and wheels are safe","required":true},{"id":"fluids","label":"Fluids and leaks checked","required":true},{"id":"guards","label":"Guards and safety equipment are secure","required":true},{"id":"controls","label":"Controls, lights, and brakes operate correctly","required":true}]',
  ),
  /** Optional editable end-of-day equipment checklist. Empty disables the mode. */
  endOfDayChecklist: jsonb("end_of_day_checklist").default("[]"),
  // ── Equipment Cost Ledger ─────────────────────────────────────────────────
  /** $/gallon used to price Fuel Log task items that only capture gallons (no dollar amount) */
  fuelPricePerGallon: real("fuel_price_per_gallon").notNull().default(4.0),
  /** $/hour cost factor applied to runtime hours logged against an asset (Operating ledger) */
  equipmentRuntimeHourlyRate: real("equipment_runtime_hourly_rate").notNull().default(0),
  /** $/hour cost of an asset being out of service for repair (Maintenance & Repair ledger) */
  equipmentDowntimeHourlyRate: real("equipment_downtime_hourly_rate").notNull().default(0),
  /** Rolling window and optional thresholds for bulk-fuel reconciliation loss warnings. */
  bulkFuelLossPeriodDays: integer("bulk_fuel_loss_period_days").notNull().default(30),
  bulkFuelLossGallonThreshold: real("bulk_fuel_loss_gallon_threshold"),
  bulkFuelLossValueThreshold: real("bulk_fuel_loss_value_threshold"),
  // ── Time Tracking ─────────────────────────────────────────────────────────
  /** Hard cap (hours) on a single master-clock shift; after this, the system auto clocks-out the staffer. Null = no cap. */
  maxClockInHours: real("max_clock_in_hours").default(12),
  /** $/hour pay rate for daily task / compliance time; 0 = display-only (no dollar value applied) */
  dailyTaskHourlyRate: real("daily_task_hourly_rate").notNull().default(0),
  // ── Non-recurring job invoicing cadence ──────────────────────────────────
  /** How completed non-recurring jobs flagged for auto-invoicing get billed: 'immediate' | 'weekly' */
  nonRecurringInvoiceCadence: text("non_recurring_invoice_cadence").notNull().default("immediate"),
  /** Ordered array of shortcut IDs shown in the quick-add bar (tenant-wide). E.g. ["new-job","new-customer","new-invoice"] */
  quickShortcuts: jsonb("quick_shortcuts").default('["new-job","new-customer","new-invoice"]'),
  /**
   * Tenant-customisable message templates for automated notifications.
   * Keys: serviceReminderSms, serviceReminderEmailSubject, serviceReminderEmailBody,
   *       paymentReminderEmailSubject, paymentReminderEmailBody, paymentReminderSms
   * Variables: {{firstName}}, {{companyName}}, {{jobTitle}}, {{date}}, {{time}}, {{address}},
   *             {{invoiceNumber}}, {{amount}}, {{dueMessage}}
   */
  notificationTemplates: jsonb("notification_templates").default('{}'),
  // ── Estimate & Invoice Defaults ───────────────────────────────────────────
  /** Days until an estimate expires (0 = no expiry). Used to auto-populate expiresAt on new estimates. */
  estimateExpiryDays: integer("estimate_expiry_days").notNull().default(30),
  renewalWarningDays: integer("renewal_warning_days").notNull().default(30),
  /** Invoice net terms in days. 0 = due on receipt. */
  invoiceDueDays: integer("invoice_due_days").notNull().default(30),
  /** Whether this business charges sales tax. When false, tax is hidden from all estimates, invoices, and reports. */
  taxEnabled: boolean("tax_enabled").notNull().default(true),
  // ── Callback / Task Due-Date Defaults ────────────────────────────────────
  /** Days from today a HIGH priority callback is due (legacy — use callbackDueHoursHigh) */
  callbackDueDaysHigh: integer("callback_due_days_high").notNull().default(1),
  /** Days from today a NORMAL priority callback is due (legacy) */
  callbackDueDaysNormal: integer("callback_due_days_normal").notNull().default(3),
  /** Days from today a LOW priority callback is due (legacy) */
  callbackDueDaysLow: integer("callback_due_days_low").notNull().default(7),
  /** Hours until a HIGH priority callback fix is due (default 4 h) */
  callbackDueHoursHigh: integer("callback_due_hours_high").notNull().default(4),
  /** Hours until a NORMAL priority callback fix is due (default 24 h) */
  callbackDueHoursNormal: integer("callback_due_hours_normal").notNull().default(24),
  /** Hours until a LOW priority callback fix is due (default 72 h = 3 days) */
  callbackDueHoursLow: integer("callback_due_hours_low").notNull().default(72),
  /** When true, a cancellation fee is charged when a customer cancels a job via the portal */
  cancellationFeeEnabled: boolean("cancellation_fee_enabled").notNull().default(false),
  /** Dollar amount charged as a cancellation fee (only applied when cancellationFeeEnabled = true) */
  cancellationFeeAmount: real("cancellation_fee_amount").notNull().default(0),
  // ── Chemical / Rainfast Weather Alerts ───────────────────────────────────
  /** Minimum hourly rain probability (0–100) that triggers a rainfast warning task when forecast before rainfastUntil */
  rainfastRainThresholdPct: integer("rainfast_rain_threshold_pct").notNull().default(40),
  /**
   * FK to invoice_templates — applied when creating new invoices.
   * No .references() here to avoid a circular import with invoiceTemplates.ts.
   */
  defaultInvoiceTemplateId: integer("default_invoice_template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
