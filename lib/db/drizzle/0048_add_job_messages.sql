-- Staff-only message thread per job.
-- Messages are scoped to a job and visible only to staff; the customer portal
-- has no route or permission that reaches these tables.
--
-- job_messages: one row per message, FK to jobs and users (sender).
-- job_message_reads: composite-PK join table tracking which staff users have
--   read which messages; absence of a row means unread for that user.

CREATE TABLE IF NOT EXISTS job_messages (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  job_id      INTEGER NOT NULL REFERENCES jobs(id),
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_messages_job_id_idx
  ON job_messages (job_id);

CREATE INDEX IF NOT EXISTS job_messages_tenant_id_idx
  ON job_messages (tenant_id);

CREATE TABLE IF NOT EXISTS job_message_reads (
  message_id  INTEGER NOT NULL REFERENCES job_messages(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
