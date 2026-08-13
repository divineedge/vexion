CREATE TABLE IF NOT EXISTS "staff_sessions" (
  "id" SERIAL PRIMARY KEY,
  "tenant_id" INTEGER NOT NULL REFERENCES "tenants"("id"),
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "staff_sessions_token_hash_idx"
  ON "staff_sessions"("token_hash");
