ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS client_message_id TEXT;
ALTER TABLE job_messages ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS staff_messages_tenant_sender_client_uidx
  ON staff_messages (tenant_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS job_messages_tenant_sender_client_uidx
  ON job_messages (tenant_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_messages_tenant_job_created_idx
  ON job_messages (tenant_id, job_id, created_at);
CREATE INDEX IF NOT EXISTS job_message_reads_user_message_idx
  ON job_message_reads (user_id, message_id);