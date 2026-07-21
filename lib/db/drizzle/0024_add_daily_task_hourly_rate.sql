ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "daily_task_hourly_rate" real DEFAULT 0 NOT NULL;
