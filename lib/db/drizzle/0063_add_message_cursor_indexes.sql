CREATE INDEX IF NOT EXISTS job_messages_tenant_job_id_desc_idx
  ON job_messages (tenant_id, job_id, id DESC);

CREATE INDEX IF NOT EXISTS staff_messages_tenant_thread_id_desc_idx
  ON staff_messages (tenant_id, thread_user_id, id DESC);