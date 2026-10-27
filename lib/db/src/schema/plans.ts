import { pgTable, text, serial, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  price: real("price").notNull().default(0),
  features: text("features").array().default([]),
  maxUsers: integer("max_users"),
  maxProperties: integer("max_properties"),
  active: boolean("active").notNull().default(true),
  billingInterval: text("billing_interval").notNull().default("month"),
  revision: integer("revision").notNull().default(1),
  publishedRevision: integer("published_revision"),
  publishedFeePolicy: jsonb("published_fee_policy"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  cardFeeBps: integer("card_fee_bps"),
  cardFeeFixedCents: integer("card_fee_fixed_cents"),
  achFeeBps: integer("ach_fee_bps"),
  achFeeFixedCents: integer("ach_fee_fixed_cents"),
  cardFeeMinCents: integer("card_fee_min_cents"),
  cardFeeMaxCents: integer("card_fee_max_cents"),
  achFeeMinCents: integer("ach_fee_min_cents"),
  achFeeMaxCents: integer("ach_fee_max_cents"),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
