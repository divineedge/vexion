-- Add GPS location capture to master clock entries
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS clock_in_lat REAL,
  ADD COLUMN IF NOT EXISTS clock_in_lng REAL,
  ADD COLUMN IF NOT EXISTS clock_out_lat REAL,
  ADD COLUMN IF NOT EXISTS clock_out_lng REAL;

-- Add GPS location capture and late-arrival tracking to job sub-timers
ALTER TABLE sub_timers
  ADD COLUMN IF NOT EXISTS start_lat REAL,
  ADD COLUMN IF NOT EXISTS start_lng REAL,
  ADD COLUMN IF NOT EXISTS end_lat REAL,
  ADD COLUMN IF NOT EXISTS end_lng REAL,
  ADD COLUMN IF NOT EXISTS is_late_arrival BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_by_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS adjusted_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjusted_stopped_at TIMESTAMPTZ;
