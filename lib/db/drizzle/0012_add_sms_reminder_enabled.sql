ALTER TABLE "jobs" ADD COLUMN "sms_reminder_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "sms_reminder_enabled" boolean NOT NULL DEFAULT false;
