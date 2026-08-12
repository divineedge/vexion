CREATE TABLE IF NOT EXISTS "portal_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "customer_id" integer NOT NULL REFERENCES "customers"("id"),
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "portal_messages_tenant_customer_idx"
  ON "portal_messages" ("tenant_id", "customer_id");

CREATE INDEX IF NOT EXISTS "portal_messages_created_at_idx"
  ON "portal_messages" ("tenant_id", "created_at" DESC);
