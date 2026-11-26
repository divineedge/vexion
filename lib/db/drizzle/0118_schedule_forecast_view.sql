CREATE TABLE IF NOT EXISTS user_schedule_forecast_views (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  start_hour integer NOT NULL DEFAULT 0,
  end_hour integer NOT NULL DEFAULT 23,
  hourly_minimized boolean NOT NULL DEFAULT false,
  minimized_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_schedule_forecast_views_tenant_idx ON user_schedule_forecast_views (tenant_id);
