ALTER TABLE services ADD COLUMN IF NOT EXISTS weekly_rate real NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS monthly_rate real NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_frequency text NOT NULL DEFAULT 'each_time';

COMMENT ON COLUMN services.base_price IS 'Each-time (per visit) price. Also the per-unit rate for measured pricing modes.';
COMMENT ON COLUMN services.weekly_rate IS 'Flat rate used when a job for this service is invoiced weekly.';
COMMENT ON COLUMN services.monthly_rate IS 'Flat rate used when a job for this service is invoiced monthly.';
COMMENT ON COLUMN jobs.invoice_frequency IS 'How often this job is invoiced: each_time, weekly, or monthly.';
