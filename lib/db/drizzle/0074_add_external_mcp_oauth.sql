CREATE TABLE IF NOT EXISTS "external_oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL UNIQUE REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "client_name" text NOT NULL,
  "redirect_uris" text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_oauth_clients_client_id_uidx" ON "external_oauth_clients" ("client_id");

CREATE TABLE IF NOT EXISTS "external_oauth_authorization_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" text[] NOT NULL,
  "code_challenge" text NOT NULL,
  "state" text,
  "decision" text,
  "decided_by_user_id" integer REFERENCES "users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "external_oauth_authorization_requests_connection_idx"
  ON "external_oauth_authorization_requests" ("connection_id", "expires_at");

CREATE TABLE IF NOT EXISTS "external_oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" text[] NOT NULL,
  "code_hash" text NOT NULL,
  "code_challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_oauth_authorization_codes_hash_uidx"
  ON "external_oauth_authorization_codes" ("code_hash");
CREATE INDEX IF NOT EXISTS "external_oauth_authorization_codes_connection_idx"
  ON "external_oauth_authorization_codes" ("connection_id", "expires_at");

CREATE TABLE IF NOT EXISTS "external_oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "external_connections"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "scopes" text[] NOT NULL,
  "allow_writes" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_oauth_access_tokens_hash_uidx"
  ON "external_oauth_access_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "external_oauth_access_tokens_connection_expires_idx"
  ON "external_oauth_access_tokens" ("connection_id", "expires_at");

CREATE TABLE IF NOT EXISTS "external_oauth_authorization_rate_limits" (
  "client_id" text NOT NULL,
  "ip_hash" text NOT NULL,
  "minute_bucket" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("client_id", "ip_hash", "minute_bucket")
);