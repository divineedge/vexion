CREATE TABLE IF NOT EXISTS broadcast_templates (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  channel text NOT NULL,
  subject text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS communication_templates (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  channel text NOT NULL,
  category text NOT NULL,
  subject text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS website_form_templates (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  purpose text NOT NULL,
  service_id integer REFERENCES services(id),
  embed_token text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS website_form_templates_slug ON website_form_templates (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS website_form_templates_token ON website_form_templates (embed_token);
CREATE TABLE IF NOT EXISTS website_form_submissions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  form_id integer NOT NULL REFERENCES website_form_templates(id),
  purpose text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_id integer,
  estimate_id integer,
  application_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
