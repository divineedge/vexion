ALTER TABLE sub_timers ADD COLUMN IF NOT EXISTS visit_id integer REFERENCES visits(id);
CREATE INDEX IF NOT EXISTS sub_timers_visit_active ON sub_timers(tenant_id,user_id,visit_id) WHERE is_active=true AND visit_id IS NOT NULL;
