-- Off-season window for standalone recurring jobs (MM-DD format, e.g. "12-01")
-- Matches the format used by services and plan templates.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS off_season_start TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS off_season_end TEXT;
