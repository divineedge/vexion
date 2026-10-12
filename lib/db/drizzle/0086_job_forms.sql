CREATE TABLE IF NOT EXISTS job_form_templates(
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),name text NOT NULL,description text NOT NULL DEFAULT '',
 fields jsonb NOT NULL DEFAULT '[]',assignment text NOT NULL DEFAULT 'manual',service_ids jsonb NOT NULL DEFAULT '[]',
 required boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_forms(
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),job_id integer NOT NULL REFERENCES jobs(id),
 template_id integer NOT NULL REFERENCES job_form_templates(id),snapshot jsonb NOT NULL,required boolean NOT NULL DEFAULT false,
 answers jsonb NOT NULL DEFAULT '{}',submitted_at timestamptz,submitted_by integer REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_forms_job_template ON job_forms(tenant_id,job_id,template_id);
CREATE TABLE IF NOT EXISTS job_form_audit(
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),form_id integer NOT NULL REFERENCES job_forms(id),
 actor_id integer NOT NULL REFERENCES users(id),event text NOT NULL,previous jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
