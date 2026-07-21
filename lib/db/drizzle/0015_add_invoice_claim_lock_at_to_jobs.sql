ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "invoice_claim_lock_at" timestamp with time zone;
