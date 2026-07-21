-- Make task_id nullable to support non-task notifications (e.g. missed call / voicemail alerts)
ALTER TABLE "task_notifications" ALTER COLUMN "task_id" DROP NOT NULL;

-- Add link_path for client-side navigation when there is no backing task
ALTER TABLE "task_notifications" ADD COLUMN IF NOT EXISTS "link_path" text;
