-- Add structured measurement zone types column (replaces flat measurementZoneLabels)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "measurement_zone_types" jsonb DEFAULT '[]';

-- Migrate existing string-array labels to structured zone type objects
-- Assigns a deterministic default color palette to the first 10 labels
UPDATE "tenants"
SET "measurement_zone_types" = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', label,
      'color', CASE (ordinality - 1) % 10
        WHEN 0 THEN '#3B82F6'
        WHEN 1 THEN '#10B981'
        WHEN 2 THEN '#F59E0B'
        WHEN 3 THEN '#EF4444'
        WHEN 4 THEN '#8B5CF6'
        WHEN 5 THEN '#06B6D4'
        WHEN 6 THEN '#84CC16'
        WHEN 7 THEN '#F97316'
        WHEN 8 THEN '#EC4899'
        WHEN 9 THEN '#6366F1'
        ELSE '#3B82F6'
      END
    )
  )
  FROM jsonb_array_elements_text("measurement_zone_labels") WITH ORDINALITY AS t(label, ordinality)
)
WHERE "measurement_zone_labels" IS NOT NULL
  AND jsonb_array_length("measurement_zone_labels") > 0
  AND ("measurement_zone_types" IS NULL OR jsonb_array_length("measurement_zone_types") = 0);
