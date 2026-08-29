ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "default_off_season_start" text,
  ADD COLUMN IF NOT EXISTS "default_off_season_end" text;