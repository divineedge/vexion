ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "field_requirements" jsonb NOT NULL DEFAULT '{}'::jsonb;