-- Add clock-in timestamp to jobs for service timeline tracking
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "clock_in_at" timestamptz;
