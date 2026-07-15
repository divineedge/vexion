ALTER TABLE "quotes" ADD COLUMN "blueprint_id" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE no action ON UPDATE no action;
