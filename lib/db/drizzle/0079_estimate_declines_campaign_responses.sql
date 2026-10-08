ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estimate_decline_reasons jsonb NOT NULL DEFAULT '["Price","Timing","Chose another provider","Service no longer needed"]';
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS decline_reason_choice text;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS not_interested_campaign_id integer;
CREATE TABLE IF NOT EXISTS campaign_responses (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 broadcast_id integer NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
 customer_id integer NOT NULL, token_hash text NOT NULL UNIQUE,
 source_campaign_id integer, destination_campaign_id integer, action text, responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS campaign_responses_customer ON campaign_responses(tenant_id,customer_id);
