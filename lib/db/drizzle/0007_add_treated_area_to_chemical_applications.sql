ALTER TABLE "chemical_applications" ADD COLUMN IF NOT EXISTS "treated_area" real;--> statement-breakpoint
ALTER TABLE "chemical_applications" ADD COLUMN IF NOT EXISTS "area_unit" text;
