ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "pricing_mode" text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS "pricing_matrix" jsonb,
  ADD COLUMN IF NOT EXISTS "linked_zone_type_id" text;
