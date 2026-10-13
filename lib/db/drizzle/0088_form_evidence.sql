-- Additive only: preserves all existing personnel and job records.
CREATE TABLE IF NOT EXISTS form_evidence (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  actor_id integer NOT NULL REFERENCES users(id),
  scope text NOT NULL,
  scope_id integer NOT NULL,
  employee_id integer,
  field_id text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  upload_path text NOT NULL,
  object_path text,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  sha256 text,
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
