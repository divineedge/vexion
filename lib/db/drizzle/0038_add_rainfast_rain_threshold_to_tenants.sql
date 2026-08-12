-- Add configurable rain probability threshold for rainfast weather alerts.
-- When a job with chemical applications is completed, the server queries
-- Open-Meteo for the property's location and creates a staff alert if
-- precipitation probability meets or exceeds this threshold before rainfastUntil.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "rainfast_rain_threshold_pct" integer NOT NULL DEFAULT 40;
