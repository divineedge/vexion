ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "business_city" text,
  ADD COLUMN IF NOT EXISTS "business_state" text,
  ADD COLUMN IF NOT EXISTS "business_zip" text,
  ADD COLUMN IF NOT EXISTS "business_lat" real,
  ADD COLUMN IF NOT EXISTS "business_lng" real,
  ADD COLUMN IF NOT EXISTS "business_mailing_same_as_physical" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "business_mailing_address" text,
  ADD COLUMN IF NOT EXISTS "business_mailing_city" text,
  ADD COLUMN IF NOT EXISTS "business_mailing_state" text,
  ADD COLUMN IF NOT EXISTS "business_mailing_zip" text;