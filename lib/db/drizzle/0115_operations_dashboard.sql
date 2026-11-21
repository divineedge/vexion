CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  widgets jsonb NOT NULL,
  task_sources jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_dashboard_layouts_tenant_idx ON user_dashboard_layouts (tenant_id);

ALTER TABLE portal_messages ADD COLUMN IF NOT EXISTS handled_at timestamptz;
ALTER TABLE portal_messages ADD COLUMN IF NOT EXISTS handled_by_user_id integer;

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS response_handled_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS response_handled_by_user_id integer;

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS maintenance_alert_ack text;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rain_warning_cleared_on text;
