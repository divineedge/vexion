ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "hold_from_billing" boolean NOT NULL DEFAULT false;
