-- General staff messaging, separate from job-scoped staff threads.
CREATE TABLE IF NOT EXISTS staff_messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  thread_user_id INTEGER NOT NULL REFERENCES users(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_messages_tenant_thread_created_idx
  ON staff_messages (tenant_id, thread_user_id, created_at);
CREATE INDEX IF NOT EXISTS staff_messages_tenant_sender_idx
  ON staff_messages (tenant_id, sender_id);

CREATE TABLE IF NOT EXISTS staff_message_reads (
  message_id INTEGER NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS staff_message_reads_user_idx
  ON staff_message_reads (user_id);