import { Router } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { checkPermission } from "../lib/rolePermissions";
import { GetKpiDashboardSettingsResponse, GetKpiDashboardReportResponse } from "@workspace/api-zod";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { defaultKpiSettings, kpiSettingsInput } from "../lib/kpiSettings";
import { billingCoverage } from "../lib/billingCoverage";
import { zonedDayBounds } from "./timeTracking";

const router = Router();
router.use(['/settings/kpis','/dashboard/kpis'], requireVerifiedStaff, async (req,res,next) => {
  const tenantId=getTenantId(req);
  const role=await getCallerRole(tenantId,getUserId(req));
  const permissions = req.originalUrl.split('?')[0].endsWith('/dashboard/kpis') ? ['pages.billing','financials.jobPrices','financials.invoiceAmounts','financials.costData'] as const : ['pages.billing'] as const;
  if (!ADMIN_ROLES.has(role) || !(await Promise.all(permissions.map(p=>checkPermission(tenantId,role,p)))).every(Boolean)) {
    res.status(403).json({error:'Financial office access required'});return;
  }
  next();
});
router.get('/settings/kpis', async(req,res) => {
  const result = await db.execute(sql`SELECT settings FROM tenant_kpi_settings WHERE tenant_id=${getTenantId(req)}`);
  res.json(GetKpiDashboardSettingsResponse.parse(result.rows[0]?.settings ?? defaultKpiSettings));
});
router.patch('/settings/kpis', async(req,res) => {
  const parsed=kpiSettingsInput.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:parsed.error.issues.map(i=>i.message).join('; ')});return;}
  await db.execute(sql`INSERT INTO tenant_kpi_settings(tenant_id,settings) VALUES(${getTenantId(req)},${JSON.stringify(parsed.data)}::jsonb)
    ON CONFLICT(tenant_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`);
  res.json(parsed.data);
});
router.get('/dashboard/kpis', async(req,res) => {
  const tenantId=getTenantId(req);
  const [tenant]=await db.select({timezone:tenantsTable.timezone}).from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  if(!tenant){res.status(404).json({error:'Company not found'});return;}
  const tz=tenant.timezone;
  const from=String(req.query.from??''),to=String(req.query.to??'');
  const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T00:00:00Z`))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
  if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>3660*86400000){
    res.status(400).json({error:'Choose valid dates, up to ten years apart'});return;
  }
  const start=zonedDayBounds(from,tz)!.start;
  const end=new Date(zonedDayBounds(to,tz)!.end.getTime()+1);
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  const previousFrom=new Date(Date.parse(from)-days*86400000).toISOString().slice(0,10);
  const previousStart=zonedDayBounds(previousFrom,tz)!.start;
  const asOf=new Date();
  const seconds=sql`GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(st.adjusted_stopped_at,st.stopped_at)-
    COALESCE(st.adjusted_started_at,st.started_at))))`;
  const [jobData,invoiceData,estimateData,callbackData,previousData,clockData,activityData,receiptData,budgetData,coverage]=await Promise.all([
    db.execute(sql`
      WITH timers AS (
        SELECT st.job_id,
          COALESCE(SUM(CASE WHEN st.is_active THEN 0 WHEN COALESCE(st.adjusted_stopped_at,st.stopped_at) IS NOT NULL THEN ${seconds} ELSE GREATEST(0,st.elapsed_seconds) END),0)/60.0 AS minutes,
          bool_or(st.is_active) AS open,
          CASE WHEN bool_or(CASE WHEN st.is_active THEN true ELSE rate.value IS NULL END) THEN NULL
            ELSE SUM((CASE WHEN COALESCE(st.adjusted_stopped_at,st.stopped_at) IS NOT NULL THEN ${seconds} ELSE GREATEST(0,st.elapsed_seconds) END)/3600.0*rate.value) END AS labor_cost
        FROM sub_timers st
        LEFT JOIN LATERAL (SELECT value FROM payroll_rates pr WHERE pr.tenant_id=st.tenant_id AND pr.source='hourly'
          AND pr.source_id=st.user_id AND pr.effective_at<=COALESCE(st.adjusted_started_at,st.started_at) ORDER BY effective_at DESC,id DESC LIMIT 1) rate ON true
        WHERE st.tenant_id=${tenantId} AND st.job_id IS NOT NULL GROUP BY st.job_id
      ), workers AS (
        SELECT st.job_id,st.user_id AS id,u.name,
          SUM(CASE WHEN st.is_active THEN 0 WHEN COALESCE(st.adjusted_stopped_at,st.stopped_at) IS NOT NULL
            THEN ${seconds} ELSE GREATEST(0,st.elapsed_seconds) END)/60.0 AS minutes
        FROM sub_timers st JOIN users u ON u.id=st.user_id AND u.tenant_id=st.tenant_id
        WHERE st.tenant_id=${tenantId} AND st.job_id IS NOT NULL GROUP BY st.job_id,st.user_id,u.name
      ), worker_lists AS (
        SELECT job_id,jsonb_agg(jsonb_build_object('id',id,'name',name,'minutes',minutes)) AS workers FROM workers GROUP BY job_id
      )
      SELECT j.id,j.title,j.customer_id,c.name AS customer_name,j.service_id,j.crew_id,cr.name AS crew_name,j.status,
        (j.scheduled_at AT TIME ZONE ${tz})::date::text AS scheduled_date,
        (j.completed_at AT TIME ZONE ${tz})::date::text AS completed_date,j.total_amount,j.estimated_duration,
        COALESCE(t.minutes,0)::float AS minutes,COALESCE(t.open,false) AS open,t.labor_cost,
        j.job_parts,
        COALESCE((SELECT sum(cost) FROM equipment_fuel_logs f WHERE f.tenant_id=j.tenant_id AND f.job_id=j.id),0)::float AS fuel_cost,
        COALESCE(w.workers,'[]'::jsonb) AS workers
      FROM jobs j LEFT JOIN timers t ON t.job_id=j.id
      LEFT JOIN worker_lists w ON w.job_id=j.id
      LEFT JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id
      LEFT JOIN crews cr ON cr.id=j.crew_id AND cr.tenant_id=j.tenant_id
      WHERE j.tenant_id=${tenantId} AND (j.archived_at IS NULL OR j.status='completed')
        AND ((j.completed_at>=${start} AND j.completed_at<${end}) OR (j.scheduled_at>=${start} AND j.scheduled_at<${end}))
      ORDER BY j.completed_at DESC NULLS LAST,j.id DESC
    `),
    db.execute(sql`SELECT i.id,i.invoice_number,i.customer_id,c.name AS customer_name,i.status,i.total,
      GREATEST(0,i.total-COALESCE(i.credit_applied,0)-COALESCE(i.deposit_applied,0))::float AS balance,
      (i.paid_at AT TIME ZONE ${tz})::date::text AS paid_date,(i.due_date AT TIME ZONE ${tz})::date::text AS due_date
      FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.tenant_id=i.tenant_id
      WHERE i.tenant_id=${tenantId} AND (i.archived_at IS NULL OR i.status='paid') AND i.status NOT IN ('void','cancelled')
      AND ((i.paid_at>=${start} AND i.paid_at<${end}) OR (i.status IN ('sent','overdue') AND i.due_date<${asOf}))`),
    db.execute(sql`SELECT e.id,c.name AS customer_name,e.total,e.status,COALESCE(e.decline_reason_choice,e.decline_reason) AS reason
      FROM estimates e LEFT JOIN customers c ON c.id=e.customer_id AND c.tenant_id=e.tenant_id
      WHERE e.tenant_id=${tenantId} AND e.archived_at IS NULL AND e.status<>'draft' AND e.sent_at>=${start} AND e.sent_at<${end}`),
    db.execute(sql`SELECT cb.id,cb.original_job_id,j.title,cb.reason,cr.name AS crew_name FROM callbacks cb
      JOIN jobs j ON j.id=cb.original_job_id AND j.tenant_id=cb.tenant_id
      LEFT JOIN crews cr ON cr.id=j.crew_id AND cr.tenant_id=j.tenant_id
      WHERE cb.tenant_id=${tenantId} AND cb.created_at>=${start} AND cb.created_at<${end}`),
    db.execute(sql`SELECT DISTINCT customer_id FROM jobs WHERE tenant_id=${tenantId} AND status='completed'
      AND customer_id IS NOT NULL AND completed_at>=${previousStart} AND completed_at<${start}`),
    db.execute(sql`SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM
      (LEAST(COALESCE(adjusted_clocked_out_at,clocked_out_at,${asOf}),${end})-
       GREATEST(COALESCE(adjusted_clocked_in_at,clocked_in_at),${start}))))),0)/60.0 AS minutes,
      count(*) FILTER(WHERE clocked_out_at IS NULL AND adjusted_clocked_out_at IS NULL)::int AS open
      FROM time_entries WHERE tenant_id=${tenantId} AND is_master_clock=true
      AND COALESCE(adjusted_clocked_in_at,clocked_in_at)<${end}
      AND COALESCE(adjusted_clocked_out_at,clocked_out_at,${asOf})>${start}`),
    db.execute(sql`SELECT CASE WHEN job_id IS NOT NULL THEN 'job' ELSE type END AS type,
      SUM(GREATEST(0,EXTRACT(EPOCH FROM
       (LEAST(COALESCE(adjusted_stopped_at,stopped_at,CASE WHEN NOT is_active THEN started_at+elapsed_seconds*interval '1 second' ELSE ${asOf} END),${end})-
        GREATEST(COALESCE(adjusted_started_at,started_at),${start})))))/60.0 AS minutes
      FROM sub_timers WHERE tenant_id=${tenantId} AND COALESCE(adjusted_started_at,started_at)<${end}
        AND COALESCE(adjusted_stopped_at,stopped_at,CASE WHEN NOT is_active THEN started_at+elapsed_seconds*interval '1 second' ELSE ${asOf} END)>${start}
      GROUP BY CASE WHEN job_id IS NOT NULL THEN 'job' ELSE type END`),
    db.execute(sql`SELECT
      (SELECT COALESCE(SUM(deposit_charged_amount),0) FROM estimates WHERE tenant_id=${tenantId} AND deposit_paid_at>=${start} AND deposit_paid_at<${end})::float AS deposits,
      (SELECT COALESCE(SUM(amount),0) FROM customer_credits WHERE tenant_id=${tenantId} AND kind='prepayment' AND created_at>=${start} AND created_at<${end})::float AS prepayments`),
    db.execute(sql`SELECT budget_data FROM tenants WHERE id=${tenantId}`),
    billingCoverage(tenantId,false),
  ]);
  const num=(value:unknown)=>Number(value??0);
  res.json(GetKpiDashboardReportResponse.parse({
    from,to,timezone:tz,asOf:asOf.toISOString(),budgetJson:budgetData.rows[0]?.budget_data==null?null:JSON.stringify(budgetData.rows[0].budget_data),
    jobs:jobData.rows.map(r=>{
      const parts=Array.isArray(r.job_parts)?r.job_parts as Record<string,unknown>[]:[];
      const invalid=!Array.isArray(r.job_parts)||parts.some(p=>!Number.isFinite(Number(p.total))||Number(p.total)<0);
      const costsMissing=parts.some(p=>p.costPrice==null||p.quantity==null||!Number.isFinite(Number(p.costPrice))||Number(p.costPrice)<0||!Number.isFinite(Number(p.quantity))||Number(p.quantity)<0);
      return {id:num(r.id),title:r.title,customerId:r.customer_id,customerName:r.customer_name??'No customer',serviceId:r.service_id,
        crewId:r.crew_id,crewName:r.crew_name??'Unassigned crew',status:r.status,scheduledDate:r.scheduled_date,completedDate:r.completed_date,
        total:num(r.total_amount),minutes:num(r.minutes),budgetMinutes:num(r.estimated_duration),openTimers:Boolean(r.open),
        materialSell:parts.reduce((s,p)=>s+num(p.total),0),materialCost:invalid||costsMissing?null:parts.reduce((s,p)=>s+num(p.costPrice)*num(p.quantity),0),
        laborCost:r.labor_cost==null?null:num(r.labor_cost),fuelCost:num(r.fuel_cost),materialsInvalid:invalid,
        workers:r.workers};
    }),
    invoices:invoiceData.rows.map(r=>({id:num(r.id),number:r.invoice_number,customerId:num(r.customer_id),customerName:r.customer_name,status:r.status,
      total:num(r.total),balance:r.status==='paid'?0:num(r.balance),paidDate:r.paid_date,dueDate:r.due_date,cash:r.status==='paid'?num(r.balance):0})),
    estimates:estimateData.rows.map(r=>({id:num(r.id),customerName:r.customer_name??'No customer',total:num(r.total),status:r.status,reason:r.reason??null})),
    callbacks:callbackData.rows.map(r=>({id:num(r.id),jobId:num(r.original_job_id),title:r.title,reason:r.reason??'Unspecified',crewName:r.crew_name??'Unassigned crew'})),
    previousCustomers:previousData.rows.map(r=>num(r.customer_id)),unbilled:coverage.jobs,
    clock:{paidMinutes:num(clockData.rows[0]?.minutes),jobMinutes:activityData.rows.filter(r=>r.type==='job').reduce((s,r)=>s+num(r.minutes),0),
      other:activityData.rows.filter(r=>r.type!=='job').map(r=>({type:String(r.type),minutes:num(r.minutes)})),openEntries:num(clockData.rows[0]?.open)},
    receipts:{deposits:num(receiptData.rows[0]?.deposits),prepayments:num(receiptData.rows[0]?.prepayments)},
  }));
});
export default router;
