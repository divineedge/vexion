ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_default_payment_method_id" text;--> statement-breakpoint
