CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "external_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "mode" text NOT NULL,
  "provider" text NOT NULL,
  "scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "allow_writes" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "webhook_secret_encrypted" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_connections_token_hash_uidx" ON "external_connections" ("token_hash");
CREATE INDEX IF NOT EXISTS "external_connections_tenant_idx" ON "external_connections" ("tenant_id");

CREATE TABLE IF NOT EXISTS "external_access_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "connection_id" uuid REFERENCES "external_connections"("id") ON DELETE SET NULL,
  "connection_name" text DEFAULT 'Unknown connection' NOT NULL,
  "action" text NOT NULL,
  "transport" text NOT NULL,
  "status" text NOT NULL,
  "request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "external_access_audit_tenant_created_idx" ON "external_access_audit" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "external_access_audit_connection_created_idx" ON "external_access_audit" ("connection_id", "created_at");

CREATE TABLE IF NOT EXISTS "external_connection_rate_limits" (
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "minute_bucket" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("connection_id", "minute_bucket")
);

CREATE TABLE IF NOT EXISTS "external_write_idempotency" (
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "idempotency_key" text NOT NULL,
  "action" text NOT NULL,
  "fingerprint" text NOT NULL,
  "resource_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("connection_id", "idempotency_key", "action")
);

CREATE TABLE IF NOT EXISTS "external_voip_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "communications_log_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_voip_events_connection_provider_event_uidx"
  ON "external_voip_events" ("connection_id", "provider", "event_id");