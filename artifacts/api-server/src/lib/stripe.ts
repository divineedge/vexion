import Stripe from "stripe";
import { db, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let _stripe: Stripe | null = null;

/**
 * Returns a Stripe client if STRIPE_SECRET_KEY is configured, otherwise null.
 * The client is lazily initialised and reused across calls.
 */
export function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  if (!_stripe) {
    // apiVersion omitted — stripe-node uses the version bundled with this release
    _stripe = new Stripe(secretKey);
  }
  return _stripe;
}

/** The Stripe publishable key for this deployment (from env). */
export function getStripePublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
}

/**
 * Ensures a Stripe Customer exists for the given tenant customer.
 * Creates one if stripeCustomerId is not yet set and writes the new ID back to the DB.
 * Returns the Stripe Customer ID.
 */
export async function ensureStripeCustomer(
  customerId: number,
  customerName: string,
  customerEmail: string,
  existingStripeCustomerId: string | null | undefined
): Promise<string> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured");

  if (existingStripeCustomerId) return existingStripeCustomerId;

  const stripeCustomer = await stripe.customers.create({
    name: customerName,
    email: customerEmail,
    metadata: { internalCustomerId: String(customerId) },
  });

  await db
    .update(customersTable)
    .set({ stripeCustomerId: stripeCustomer.id })
    .where(eq(customersTable.id, customerId));

  return stripeCustomer.id;
}
