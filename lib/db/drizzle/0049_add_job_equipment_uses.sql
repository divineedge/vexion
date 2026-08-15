-- Track equipment hours logged on each job.
-- equipmentName is stored as text so records remain readable after equipment is archived.
-- equipmentId is a soft FK (no DB constraint) to allow manual free-text entries.

CREATE TABLE IF NOT EXISTS job_equipment_uses (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  job_id          INTEGER NOT NULL REFERENCES jobs(id),
  equipment_name  TEXT NOT NULL,
  equipment_id    INTEGER,
  hours_used      REAL NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_equipment_uses_job_id_idx
  ON job_equipment_uses (job_id);

CREATE INDEX IF NOT EXISTS job_equipment_uses_equipment_id_idx
  ON job_equipment_uses (equipment_id)
  WHERE equipment_id IS NOT NULL;
