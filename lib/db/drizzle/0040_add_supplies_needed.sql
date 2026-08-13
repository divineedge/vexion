ALTER TABLE estimates ADD COLUMN IF NOT EXISTS supplies_needed jsonb NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS supplies_needed jsonb NOT NULL DEFAULT '[]';
