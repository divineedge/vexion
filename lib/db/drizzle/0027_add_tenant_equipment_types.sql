CREATE TABLE IF NOT EXISTS "tenant_equipment_types" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed defaults for every existing tenant
INSERT INTO "tenant_equipment_types" ("tenant_id", "label", "sort_order")
SELECT t.id, v.label, v.sort_order
FROM "tenants" t
CROSS JOIN (VALUES
  ('Mower',    0),
  ('Truck',    1),
  ('Trailer',  2),
  ('Sprayer',  3),
  ('Blower',   4),
  ('Edger',    5),
  ('Chainsaw', 6),
  ('Other',    7)
) AS v(label, sort_order);
