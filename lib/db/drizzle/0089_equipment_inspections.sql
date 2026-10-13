-- Additive development migration; production schema additions go through Publish.
CREATE TABLE IF NOT EXISTS equipment_inspections (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 equipment_id integer NOT NULL REFERENCES equipment(id), context_type text NOT NULL DEFAULT 'equipment',
 inspection_type text NOT NULL, title text NOT NULL, description text,
 created_by_id integer NOT NULL REFERENCES users(id), idempotency_key text NOT NULL,
 request_fingerprint text NOT NULL, fuel_log_id integer, reading_log_id integer,
 checklist_snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_inspections_retry_unique ON equipment_inspections(tenant_id,idempotency_key);
CREATE TABLE IF NOT EXISTS equipment_inspection_reviews (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 inspection_ref text NOT NULL, reviewed_by_id integer NOT NULL REFERENCES users(id),
 notes text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
