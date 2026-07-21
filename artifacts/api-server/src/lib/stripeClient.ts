import Stripe from "stripe";
import { logger } from "./logger";

/**
 * Returns a Stripe instance for the given secret key, or null if no key is set.
 * Using lazy initialization so the server can start without Stripe configured.
 */
export function getStripeClient(secretKey?: string | null): Stripe | null {
  const key = secretKey ?? process.env["STRIPE_SECRET_KEY"] ?? null;
  if (!key) {
    logger.warn("STRIPE_SECRET_KEY is not set — Stripe payments are unavailable");
    return null;
  }
  return new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
}
