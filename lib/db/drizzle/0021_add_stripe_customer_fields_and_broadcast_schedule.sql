-- Add Stripe customer tracking fields (used by payment-on-file and online payment flows)
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_default_payment_method_id" text;--> statement-breakpoint

-- Add scheduled_for to broadcasts to support deferred/scheduled broadcast sends
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;--> statement-breakpoint
