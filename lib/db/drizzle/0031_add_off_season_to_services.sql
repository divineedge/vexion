ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "off_season_start" text,
  ADD COLUMN IF NOT EXISTS "off_season_end" text;
