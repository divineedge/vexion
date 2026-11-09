ALTER TABLE services
  ADD COLUMN IF NOT EXISTS hourly_rate real,
  ADD COLUMN IF NOT EXISTS minimum_billable_minutes integer;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS billable_minutes integer;

COMMENT ON COLUMN services.hourly_rate IS 'Dollars per hour when pricing_mode is hourly.';
COMMENT ON COLUMN services.minimum_billable_minutes IS 'Minimum minutes billed for an hourly service. Null bills the exact crew time.';
COMMENT ON COLUMN jobs.billable_minutes IS 'Crew minutes attached to this job through sub_timers, used to price hourly services. Line items keep the hours, rate, and any manual override.';
