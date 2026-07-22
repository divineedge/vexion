ALTER TABLE "plan_templates"
  ADD COLUMN IF NOT EXISTS "pricing_mode" text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS "pricing_matrix" jsonb;
