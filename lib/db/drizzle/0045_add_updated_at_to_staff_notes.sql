-- Add updated_at column to staff_notes for inline edit tracking
ALTER TABLE staff_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
