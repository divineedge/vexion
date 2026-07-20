ALTER TABLE "equipment_fuel_logs" ADD COLUMN "job_id" integer REFERENCES "jobs"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fuel_logs_job_id_idx" ON "equipment_fuel_logs" ("job_id");
