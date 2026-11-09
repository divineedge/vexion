ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_reminders_mode text NOT NULL DEFAULT 'enabled';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS excluded_reminder_service_ids integer[] NOT NULL DEFAULT '{}';
