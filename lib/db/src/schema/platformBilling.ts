import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";
import { plansTable } from "./plans";

export const platformOwnersTable = pgTable("platform_owners", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});
export const platformBillingSettingsTable = pgTable("platform_billing_settings", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  cardFeeBps: integer("card_fee_bps").notNull().default(0),
  cardFeeFixedCents: integer("card_fee_fixed_cents").notNull().default(0),
  achFeeBps: integer("ach_fee_bps").notNull().default(0),
  achFeeFixedCents: integer("ach_fee_fixed_cents").notNull().default(0),
});
export const softwareBillingAccountsTable = pgTable("software_billing_accounts", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenantsTable.id),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  planId: integer("plan_id").references(() => plansTable.id),
  status: text("status").notNull().default("none"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  connectAccountId: text("connect_account_id").unique(),
  connectReady: boolean("connect_ready").notNull().default(false),
  connectCreateKey: text("connect_create_key"),
  connectStartedAt: timestamp("connect_started_at", { withTimezone: true }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  checkoutKey: text("checkout_key"),
  checkoutStartedAt: timestamp("checkout_started_at", { withTimezone: true }),
  checkoutSessionId: text("checkout_session_id"),
  checkoutUrl: text("checkout_url"),
  checkoutPlanId: integer("checkout_plan_id"),
});
export const softwarePlanPricesTable = pgTable("software_plan_prices", {
  stripePriceId: text("stripe_price_id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => plansTable.id),
});
export const platformPaymentAllocationsTable = pgTable("platform_payment_allocations", {
  paymentIntentId: text("payment_intent_id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  connectAccountId: text("connect_account_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  processorFeeCents: integer("processor_fee_cents"),
  requestedFeeCents: integer("requested_fee_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents"),
  payoutCents: integer("payout_cents"),
  transferId: text("transfer_id").unique(),
  status: text("status").notNull().default("pending"),
  reverseRequested: boolean("reverse_requested").notNull().default(false),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
});
export const platformBillingAuditTable = pgTable("platform_billing_audit", {
  id: text("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
