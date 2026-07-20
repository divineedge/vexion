ALTER TABLE "followup_queue_items" ADD COLUMN "assigned_to_user_id" integer REFERENCES "users"("id");
