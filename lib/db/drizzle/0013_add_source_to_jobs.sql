ALTER TABLE "jobs" ADD COLUMN "source" text;--> statement-breakpoint
-- Backfill: mark existing portal-submitted requests.
-- The portal POST route always creates jobs with title='Service Request' and plan_id IS NULL.
-- This is the best available signal for pre-migration portal requests.
UPDATE "jobs"
SET "source" = 'portal'
WHERE "title" = 'Service Request'
  AND "plan_id" IS NULL
  AND "source" IS NULL;
