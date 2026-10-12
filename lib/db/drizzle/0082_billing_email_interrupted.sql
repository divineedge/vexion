ALTER TABLE billing_email_queue ADD COLUMN IF NOT EXISTS delivery_provider text;
ALTER TABLE billing_email_queue ADD COLUMN IF NOT EXISTS delivery_recipient text;
ALTER TABLE billing_email_queue ADD COLUMN IF NOT EXISTS provider_message_id text;
UPDATE billing_email_queue SET status = 'interrupted',
  error_msg = 'A previous delivery was attempted. Verify the original provider before retrying.'
WHERE status = 'pending' AND attempts > 0;
