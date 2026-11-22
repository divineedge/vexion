ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_attention_handled_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_attention_handled_by_user_id integer;
