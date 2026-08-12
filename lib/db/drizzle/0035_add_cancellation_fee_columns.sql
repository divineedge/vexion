-- Add cancellation-fee policy columns to tenants and charge-link column to jobs
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "cancellation_fee_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancellation_fee_amount" real NOT NULL DEFAULT 0;

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "cancellation_charge_id" integer;
