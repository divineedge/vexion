CREATE TABLE IF NOT EXISTS staff_notification_devices (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  user_id integer NOT NULL REFERENCES users(id),
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_notification_devices_tenant_user_enabled_idx
  ON staff_notification_devices (tenant_id, user_id, is_enabled);

CREATE TABLE IF NOT EXISTS staff_push_deliveries (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  device_id integer NOT NULL REFERENCES staff_notification_devices(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_push_deliveries_device_event_uidx UNIQUE (device_id, event_key)
);
CREATE INDEX IF NOT EXISTS staff_push_deliveries_tenant_event_idx
  ON staff_push_deliveries (tenant_id, event_key);