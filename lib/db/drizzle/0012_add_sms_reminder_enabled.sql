ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "sms_reminder_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "sms_reminder_enabled" boolean NOT NULL DEFAULT false;
