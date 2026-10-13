import { Router } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { GetPricingHistoryReportResponse } from "@workspace/api-zod";
import { zonedDayBounds } from "./timeTracking";

const router = Router();
router.use("/reports/pricing-review", requireVerifiedStaff);
router.get("/reports/pricing-review", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const parts = new Intl.DateTimeFormat("en-US",{timeZone:tenant.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const calendar = Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const today = `${calendar.year}-${calendar.month}-${calendar.day}`;
  const to = String(req.query.to ?? today);
  const from = String(req.query.from ?? new Date(Date.parse(`${today}T00:00:00Z`) - 90*86400000).toISOString().slice(0,10));
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to)-Date.parse(from) > 731*86400000) {
    res.status(400).json({ error: "Choose a valid date range of at most two years" }); return;
  }
  const start = zonedDayBounds(from,tenant.timezone)!.start;
  const end = zonedDayBounds(to,tenant.timezone)!.end;
  const [history, budget, missing] = await Promise.all([
    db.execute(sql`
      WITH durations AS (
        SELECT job_id, SUM(CASE WHEN NOT is_active THEN GREATEST(0,
          CASE WHEN adjusted_stopped_at IS NOT NULL AND COALESCE(adjusted_started_at,started_at) IS NOT NULL
            THEN EXTRACT(EPOCH FROM (adjusted_stopped_at-COALESCE(adjusted_started_at,started_at)))
          WHEN adjusted_started_at IS NOT NULL AND stopped_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (stopped_at-adjusted_started_at))
          ELSE elapsed_seconds END) ELSE 0 END)/60.0 AS minutes,
          bool_or(is_active) AS open
        FROM sub_timers WHERE tenant_id=${tenantId} AND job_id IS NOT NULL GROUP BY job_id
      )
      SELECT j.id,j.title,j.customer_id,c.name AS customer_name,p.address AS property_address,
        j.service_id,s.name AS service_name,s.pricing_mode AS pricing_type,j.completed_at,
        COALESCE(d.minutes,0)::float AS minutes,COALESCE(d.open,false) AS open,j.total_amount,
        (j.job_parts IS NOT NULL AND (jsonb_typeof(j.job_parts)<>'array' OR EXISTS(
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.job_parts)='array' THEN j.job_parts ELSE '[]'::jsonb END) part
          WHERE part->>'total' IS NULL OR NOT (part->>'total' ~ '^[0-9]+(\\.[0-9]+)?$')))) AS materials_missing,
        COALESCE((SELECT SUM(CASE WHEN part->>'total' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (part->>'total')::numeric ELSE 0 END)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.job_parts)='array' THEN j.job_parts ELSE '[]'::jsonb END) part),0)::float AS materials
      FROM jobs j LEFT JOIN durations d ON d.job_id=j.id
      LEFT JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id
      LEFT JOIN properties p ON p.id=j.property_id AND p.tenant_id=j.tenant_id
      LEFT JOIN services s ON s.id=j.service_id AND s.tenant_id=j.tenant_id
      WHERE j.tenant_id=${tenantId} AND j.status='completed' AND j.completed_at >= ${start} AND j.completed_at < ${end}
      ORDER BY j.completed_at DESC,j.id DESC
    `),
    db.execute(sql`SELECT budget_data FROM tenants WHERE id=${tenantId}`),
    db.execute(sql`SELECT count(*)::int AS count FROM jobs WHERE tenant_id=${tenantId} AND status='completed' AND completed_at IS NULL`),
  ]);
  res.json(GetPricingHistoryReportResponse.parse({
    budgetJson: budget.rows[0]?.budget_data == null ? null : JSON.stringify(budget.rows[0].budget_data),
    missingCompletionDates: Number(missing.rows[0]?.count ?? 0),
    jobs: history.rows.map(row => ({
      id: Number(row.id), title: String(row.title), customerId: row.customer_id == null ? null : Number(row.customer_id),
      customerName: row.customer_name ?? null, propertyAddress: row.property_address ?? null,
      serviceId: row.service_id == null ? null : Number(row.service_id), serviceName: row.service_name ?? null,
      pricingType: row.pricing_type ?? null, completedAt: new Date(String(row.completed_at)).toISOString(),
      recordedMinutes: Number(row.minutes), totalAmount: Number(row.total_amount),
      materialSellAmount: Number(row.materials), hasOpenTimers: Boolean(row.open),
      materialSnapshotMissing: Boolean(row.materials_missing),
    })),
  }));
});
export default router;
