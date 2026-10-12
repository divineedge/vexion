import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean, date, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const customersTable = pgTable("customers", {
  paymentPolicy: jsonb("payment_policy"),
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  secondaryPhone: text("secondary_phone"),
  company: text("company"),
  customerType: text("customer_type"),
  referralSource: text("referral_source"),
  referringCustomerId: integer("referring_customer_id").references((): AnyPgColumn => customersTable.id, { onDelete: "set null" }),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  /** Service/property address. Billing fields above remain the mailing address. */
  physicalAddress: text("physical_address"),
  physicalCity: text("physical_city"),
  physicalState: text("physical_state"),
  physicalZip: text("physical_zip"),
  notes: text("notes"),
  tags: text("tags").array().default([]),
  customFieldValues: jsonb("custom_field_values").default("{}"),
  /** Campaign that acquired this customer (denormalised for quick lookup) */
  acquiredFromCampaignId: integer("acquired_from_campaign_id"),
  /** Customer opted out of SMS communications */
  smsOptOut: boolean("sms_opt_out").notNull().default(false),
  /** Customer opted out of email communications */
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  /** Automatically create and send invoice when a job is marked complete */
  autoInvoiceOnCompletion: boolean("auto_invoice_on_completion").notNull().default(false),
  /** Profile photo URL (stored objectPath) */
  profilePhotoUrl: text("profile_photo_url"),
  /** Stripe Customer ID (cus_xxx) — set when customer first provides a payment method */
  stripeCustomerId: text("stripe_customer_id"),
  /** Stripe PaymentMethod ID (pm_xxx) saved as default for off-session use */
  stripeDefaultPaymentMethodId: text("stripe_default_payment_method_id"),
  /** When true, the "no card on file" alert is suppressed for this customer */
  noCardAlertSilenced: boolean("no_card_alert_silenced").notNull().default(false),
  /** Last day of the month the saved card expires — stored so the scheduler can query without hitting Stripe */
  cardExpiresAt: date("card_expires_at"),
  /** When the card-expiry reminder was last sent; null = never sent */
  cardExpiryReminderSentAt: timestamp("card_expiry_reminder_sent_at", { withTimezone: true }),
  totalSpend: real("total_spend").notNull().default(0),
  /** Set when the customer is archived; null means active */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
