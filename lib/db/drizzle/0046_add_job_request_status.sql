-- Add staff-response status and reply columns to the cancel/reschedule request flow
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_request_status TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_request_reply TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reschedule_request_status TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reschedule_request_reply TEXT;
