-- Additive only. Apply to development; Publish manages production schema.
ALTER TABLE hr_settings ADD COLUMN IF NOT EXISTS credential_warning_days integer NOT NULL DEFAULT 30;
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS credential_type text;
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS expires_on date;
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS renews_document_id integer REFERENCES hr_documents(id);
CREATE UNIQUE INDEX IF NOT EXISTS hr_document_single_renewal ON hr_documents(renews_document_id);
CREATE TABLE IF NOT EXISTS hr_credential_notices (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL REFERENCES tenants(id),
 document_id integer NOT NULL REFERENCES hr_documents(id),
 recipient_user_id integer NOT NULL REFERENCES users(id),
 expires_on date NOT NULL,
 phase text NOT NULL,
 notification_id integer
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_credential_notice_once ON hr_credential_notices(document_id,recipient_user_id,expires_on,phase);
