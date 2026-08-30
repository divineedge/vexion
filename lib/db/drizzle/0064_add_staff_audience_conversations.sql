ALTER TABLE divisions ADD COLUMN IF NOT EXISTS category TEXT;

CREATE TABLE IF NOT EXISTS staff_message_conversations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  audience_type TEXT NOT NULL,
  audience_id INTEGER,
  audience_key TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_message_conversations_tenant_audience_uidx
  ON staff_message_conversations (tenant_id, audience_key);
CREATE INDEX IF NOT EXISTS staff_message_conversations_tenant_updated_idx
  ON staff_message_conversations (tenant_id, updated_at);

ALTER TABLE staff_messages
  ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES staff_message_conversations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS staff_messages_tenant_conversation_id_desc_idx
  ON staff_messages (tenant_id, conversation_id, id DESC);