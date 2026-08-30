ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "chemical_record_requirements" jsonb
  DEFAULT '{"treatedArea":false,"treatedZoneName":false,"targetPest":false,"applicationMethod":false,"windSpeed":false,"windDirection":false,"temperature":false,"applicatorName":false,"applicatorLicenseNumber":false,"notes":false}'::jsonb;