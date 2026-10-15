import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive only. Existing jobs deliberately keep a missing historical baseline. */
export async function installJobEconomicsSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS job_report_baselines (
      job_id integer PRIMARY KEY REFERENCES jobs(id),
      tenant_id integer NOT NULL REFERENCES tenants(id), baseline jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS estimate_report_baselines (
      estimate_id integer PRIMARY KEY REFERENCES estimates(id),
      tenant_id integer NOT NULL REFERENCES tenants(id), baseline jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_other_costs (
      id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
      job_id integer NOT NULL REFERENCES jobs(id),
      description text NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0),
      expense_id integer REFERENCES expense_entries(id),
      request_id text NOT NULL, request_fingerprint text NOT NULL,
      created_by integer NOT NULL REFERENCES users(id), created_by_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      voided_at timestamptz, voided_by integer REFERENCES users(id), void_reason text,
      CONSTRAINT job_other_costs_request_once UNIQUE(tenant_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS job_other_costs_job_idx ON job_other_costs(tenant_id,job_id);
    CREATE OR REPLACE FUNCTION protect_job_other_cost_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Job cost history cannot be deleted; void the allocation'; END IF;
      IF (to_jsonb(NEW)-'voided_at'-'voided_by'-'void_reason') IS DISTINCT FROM
         (to_jsonb(OLD)-'voided_at'-'voided_by'-'void_reason')
        OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.voided_by IS NULL
        OR trim(COALESCE(NEW.void_reason,''))='' THEN
        RAISE EXCEPTION 'Job costs are immutable; record an attributed void';
      END IF;
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS protect_job_other_cost_history_trigger ON job_other_costs;
    CREATE TRIGGER protect_job_other_cost_history_trigger BEFORE UPDATE OR DELETE ON job_other_costs
      FOR EACH ROW EXECUTE FUNCTION protect_job_other_cost_history();
    CREATE OR REPLACE FUNCTION protect_allocated_job_expense() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE allocated numeric;
    BEGIN
      SELECT sum(amount) INTO allocated FROM job_other_costs
        WHERE expense_id=OLD.id AND tenant_id=OLD.tenant_id AND voided_at IS NULL;
      IF allocated IS NOT NULL AND NEW.amount < allocated THEN
        RAISE EXCEPTION 'Expense total cannot be below active job allocations; void those allocations first' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS protect_allocated_job_expense_trigger ON expense_entries;
    CREATE TRIGGER protect_allocated_job_expense_trigger BEFORE UPDATE OF amount ON expense_entries
      FOR EACH ROW EXECUTE FUNCTION protect_allocated_job_expense();
    CREATE OR REPLACE FUNCTION capture_estimate_report_costs() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE planned_cost numeric;
    BEGIN
      IF TG_OP='UPDATE' AND NEW.supplies_needed IS NOT DISTINCT FROM OLD.supplies_needed THEN
        RETURN NEW;
      END IF;
      SELECT CASE WHEN count(*) FILTER(WHERE i.id IS NULL OR NOT COALESCE(s->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$',false))>0
        THEN NULL ELSE COALESCE(SUM(CASE WHEN s->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (s->>'quantity')::numeric*i.unit_price END),0) END
        INTO planned_cost FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.supplies_needed)='array'
          THEN NEW.supplies_needed ELSE '[]'::jsonb END) s
        LEFT JOIN inventory_items i ON i.id=CASE WHEN s->>'inventoryItemId' ~ '^[0-9]+$'
          THEN (s->>'inventoryItemId')::integer END AND i.tenant_id=NEW.tenant_id;
      INSERT INTO estimate_report_baselines(estimate_id,tenant_id,baseline)
        VALUES(NEW.id,NEW.tenant_id,jsonb_build_object('capturedAt',now(),'materialCost',planned_cost))
        ON CONFLICT(estimate_id) DO UPDATE SET baseline=EXCLUDED.baseline;
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS capture_estimate_report_costs_trigger ON estimates;
    CREATE TRIGGER capture_estimate_report_costs_trigger AFTER INSERT OR UPDATE OF supplies_needed ON estimates
      FOR EACH ROW EXECUTE FUNCTION capture_estimate_report_costs();
    CREATE OR REPLACE FUNCTION capture_job_report_baseline() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE service_data jsonb; property_data jsonb; zones jsonb; planned_cost numeric;
      planned_rate numeric;
    BEGIN
      -- Caller-supplied JSON cannot manufacture historical costs.
      SELECT jsonb_build_object('name',name,'pricingMode',pricing_mode,
        'pricingMatrix',pricing_matrix,'linkedZoneTypeId',linked_zone_type_id)
        INTO service_data FROM services WHERE tenant_id=NEW.tenant_id AND
          (id=NEW.service_id OR (NEW.service_id IS NULL AND id::text = (
            SELECT CASE WHEN count(DISTINCT li->>'serviceId')=1 THEN min(li->>'serviceId') END
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.line_items)='array' THEN NEW.line_items ELSE '[]'::jsonb END) li
            WHERE li->>'serviceId' ~ '^[1-9][0-9]*$'
          )));
      SELECT jsonb_build_object('serviceableAreaSqft',serviceable_area_sqft,
        'measurementPolygons',measurement_polygons)
        INTO property_data FROM properties WHERE id=NEW.property_id AND tenant_id=NEW.tenant_id;
      SELECT measurement_zone_types INTO zones FROM tenants WHERE id=NEW.tenant_id;
      SELECT CASE WHEN count(*) FILTER(WHERE i.id IS NULL OR NOT COALESCE(s->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$',false))>0
        THEN NULL ELSE COALESCE(SUM(CASE WHEN s->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (s->>'quantity')::numeric*i.unit_price END),0) END
        INTO planned_cost
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.supplies_needed)='array'
          THEN NEW.supplies_needed ELSE '[]'::jsonb END) s
        LEFT JOIN inventory_items i ON i.id=CASE WHEN s->>'inventoryItemId' ~ '^[0-9]+$'
          THEN (s->>'inventoryItemId')::integer END AND i.tenant_id=NEW.tenant_id;
      SELECT CASE WHEN count(*)>0 AND count(r.value)=count(*) THEN avg(r.value) ELSE NULL END
        INTO planned_rate
        FROM users u LEFT JOIN LATERAL (
          SELECT value FROM payroll_rates r WHERE r.tenant_id=NEW.tenant_id AND r.source='hourly'
            AND r.source_id=u.id AND r.effective_at<=NEW.created_at
            ORDER BY effective_at DESC,id DESC LIMIT 1
        ) r ON true
        WHERE u.tenant_id=NEW.tenant_id AND (u.id=NEW.assignee_id OR u.id IN (
          SELECT cm.user_id FROM crew_members cm JOIN crews c ON c.id=cm.crew_id
          WHERE cm.crew_id=NEW.crew_id AND c.tenant_id=NEW.tenant_id
        ));
      INSERT INTO job_report_baselines(job_id,tenant_id,baseline) VALUES(NEW.id,NEW.tenant_id,jsonb_build_object('version',1,'capturedAt',now(),
        'budgetRevenue',NEW.total_amount,'budgetMinutes',NULLIF(NEW.estimated_duration,0),
        'budgetMaterialCost',planned_cost,
        'budgetLaborCost',CASE WHEN NEW.estimated_duration>0 THEN planned_rate*NEW.estimated_duration/60.0 ELSE NULL END,
        'source','Scheduling snapshot','service',service_data,'property',property_data,'zones',zones));
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS capture_job_report_baseline_trigger ON jobs;
    CREATE TRIGGER capture_job_report_baseline_trigger AFTER INSERT ON jobs
      FOR EACH ROW EXECUTE FUNCTION capture_job_report_baseline();
    CREATE OR REPLACE FUNCTION capture_converted_estimate_baseline() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.converted_to_job_id IS NOT NULL AND OLD.converted_to_job_id IS NULL THEN
        UPDATE job_report_baselines b SET baseline=b.baseline ||
          jsonb_build_object('version',1,'capturedAt',now(),'source','Estimate snapshot; labor planned at scheduling',
            'estimateId',NEW.id,'budgetRevenue',NEW.subtotal,'taxAmount',NEW.tax,
            'budgetMaterialCost',(SELECT baseline->'materialCost' FROM estimate_report_baselines
              WHERE estimate_id=NEW.id AND tenant_id=NEW.tenant_id),
            'budgetMinutes',NULLIF(NEW.estimated_duration_min,0))
          WHERE b.job_id=NEW.converted_to_job_id AND b.tenant_id=NEW.tenant_id AND EXISTS(
            SELECT 1 FROM jobs j WHERE j.id=b.job_id AND j.tenant_id=b.tenant_id AND j.customer_id=NEW.customer_id
          );
      END IF;
      RETURN NEW;
    END $fn$;
    DROP TRIGGER IF EXISTS capture_converted_estimate_baseline_trigger ON estimates;
    CREATE TRIGGER capture_converted_estimate_baseline_trigger AFTER UPDATE OF converted_to_job_id ON estimates
      FOR EACH ROW EXECUTE FUNCTION capture_converted_estimate_baseline();
  `);
}
