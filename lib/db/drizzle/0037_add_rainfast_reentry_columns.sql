-- Add rainfast hours to chemical products
ALTER TABLE "chemical_products"
  ADD COLUMN IF NOT EXISTS "rainfast_hours" real;

-- Add computed timer expiry columns to chemical applications
ALTER TABLE "chemical_applications"
  ADD COLUMN IF NOT EXISTS "rainfast_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "reentry_until" timestamptz;
