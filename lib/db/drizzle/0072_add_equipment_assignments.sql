ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "assigned_user_id" integer;
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "assigned_crew_id" integer;

DO $$ BEGIN
  ALTER TABLE "equipment"
    ADD CONSTRAINT "equipment_assigned_user_id_users_id_fk"
    FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "equipment"
    ADD CONSTRAINT "equipment_assigned_crew_id_crews_id_fk"
    FOREIGN KEY ("assigned_crew_id") REFERENCES "public"."crews"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "equipment_tenant_assigned_user_idx"
  ON "equipment" ("tenant_id", "assigned_user_id");
CREATE INDEX IF NOT EXISTS "equipment_tenant_assigned_crew_idx"
  ON "equipment" ("tenant_id", "assigned_crew_id");