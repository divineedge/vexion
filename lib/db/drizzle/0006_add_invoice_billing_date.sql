-- Add billing_date column to invoices for recurring-template idempotency tracking.
-- When the billing scheduler auto-generates an invoice it stamps this column with
-- the UTC calendar date of the billing cycle. The unique partial index below makes
-- it impossible (at the DB level) to insert a second invoice for the same
-- template+customer on the same billing date, guarding against double-runs even
-- if two scheduler processes race past the application-level lock.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billing_date" date;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_template_customer_billing_date_uidx"
  ON "invoices" ("generated_from_template_id", "customer_id", "billing_date")
  WHERE generated_from_template_id IS NOT NULL AND billing_date IS NOT NULL;
