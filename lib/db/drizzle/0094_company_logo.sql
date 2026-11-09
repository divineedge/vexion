CREATE TABLE IF NOT EXISTS tenant_logos (
  tenant_id integer PRIMARY KEY REFERENCES tenants(id),
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Storage policies apply only on Supabase. The upload itself uses the service
-- role, which is not blocked by these policies. Public read lets the saved
-- object URL load in invoices and the customer portal.
DO $logo$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('company-logos', 'company-logos', true)
      ON CONFLICT (id) DO UPDATE SET public = true;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    BEGIN
      DROP POLICY IF EXISTS company_logos_public_read ON storage.objects;
      CREATE POLICY company_logos_public_read ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'company-logos');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END
$logo$;
