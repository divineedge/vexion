CREATE TABLE IF NOT EXISTS "plan_cancel_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_cancel_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
	CONSTRAINT "plan_cancel_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
	CONSTRAINT "plan_cancel_requests_plan_id_customer_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "customer_plans"("id")
);
--> statement-breakpoint
-- Enforce at most one pending request per plan (race-safe duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS "plan_cancel_requests_plan_pending_unique"
  ON "plan_cancel_requests" ("plan_id")
  WHERE "status" = 'pending';
