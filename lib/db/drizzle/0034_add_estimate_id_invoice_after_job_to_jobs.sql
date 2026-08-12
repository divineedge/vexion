-- Add estimate back-reference and deferred-billing flag to jobs
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "estimate_id" integer,
  ADD COLUMN IF NOT EXISTS "invoice_after_job" boolean NOT NULL DEFAULT false;
