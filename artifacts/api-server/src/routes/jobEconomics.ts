import { Router } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { GetJobEconomicsReportResponse } from "@workspace/api-zod";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { checkPermission } from "../lib/rolePermissions";
import { zonedDayBounds } from "./timeTracking";
import { array, record, finite, money, materialBreakdown, jobMeasurement, reportCostTotals } from "../lib/jobEconomics";

const router = Router();
router.use("/reports/job-economics", requireVerifiedStaff, async (req,res,next) => {
  const tenantId = getTenantId(req), role = await getCallerRole(tenantId,getUserId(req));
  const permissions = ["pages.billing","financials.costData","financials.jobPrices","financials.invoiceAmounts"] as const;
  if (!ADMIN_ROLES.has(role) || !(await Promise.all(permissions.map(p=>checkPermission(tenantId,role,p)))).every(Boolean)) {
    res.status(403).json({error:"Financial office access required"}); return;
  }
  next();
});
const calendar = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))
  && new Date(s).toISOString().slice(0,10) === s;
const id = (v: unknown) => typeof v === "string" && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v)<=2147483647 ? Number(v) : null;
const costOutput = (raw: Record<string,unknown>) => ({
  id:Number(raw.id), description:String(raw.description), amount:Number(raw.amount),
  expenseId:raw.expense_id==null?null:Number(raw.expense_id),
  createdAt:new Date(String(raw.created_at)).toISOString(), createdByName:String(raw.created_by_name),
  voidedAt:raw.voided_at==null?null:new Date(String(raw.voided_at)).toISOString(),
  voidReason:raw.void_reason==null?null:String(raw.void_reason),
});

router.get("/reports/job-economics",async(req,res) => {
  const tenantId=getTenantId(req), from=String(req.query.from??""), to=String(req.query.to??"");
  if (!calendar(from)||!calendar(to)||from>to||Date.parse(to)-Date.parse(from)>731*86400000) {
    res.status(400).json({error:"Choose valid completion dates no more than two years apart"}); return;
  }
  const customerId=req.query.customerId===undefined?undefined:Number(req.query.customerId);
  const serviceId=req.query.serviceId===undefined?undefined:Number(req.query.serviceId);
  if ([customerId,serviceId].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0||v>2147483647))) {
    res.status(400).json({error:"Choose a valid customer and service"}); return;
  }
  const [tenant]=await db.select({timezone:tenantsTable.timezone, zones:tenantsTable.measurementZoneTypes})
    .from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  if (!tenant) {res.status(404).json({error:"Company not found"});return;}
  const start=zonedDayBounds(from,tenant.timezone)!.start;
  // zonedDayBounds.end is already the exclusive next local midnight.
  const end=zonedDayBounds(to,tenant.timezone)!.end;
  const serviceFilter=serviceId===undefined?sql``:serviceId===0?sql`AND j.service_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.line_items)='array' THEN j.line_items ELSE '[]'::jsonb END) li WHERE li->>'serviceId' ~ '^[1-9][0-9]*$')`
    :sql`AND (j.service_id=${serviceId} OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.line_items)='array' THEN j.line_items ELSE '[]'::jsonb END) li WHERE li->>'serviceId'=${String(serviceId)}))`;
  const [data,customers,services]=await Promise.all([
    db.execute(sql`
      WITH cohort AS (
        SELECT j.id,j.title,j.customer_id,j.property_id,j.service_id,j.completed_at,j.total_amount,
          j.estimated_duration,j.line_items,j.job_parts,j.supplies_needed,b.baseline AS report_baseline
        FROM jobs j LEFT JOIN job_report_baselines b ON b.job_id=j.id AND b.tenant_id=j.tenant_id
        WHERE j.tenant_id=${tenantId} AND j.status='completed'
          AND j.completed_at>=${start} AND j.completed_at<${end}
          ${customerId===undefined?sql``:customerId===0?sql`AND j.customer_id IS NULL`:sql`AND j.customer_id=${customerId}`}
          ${serviceFilter}
        ORDER BY j.completed_at DESC,j.id DESC LIMIT 10001
      ), timer_base AS (
        SELECT st.id,st.job_id,st.user_id,st.is_active,
          COALESCE(st.adjusted_started_at,st.started_at) AS began,
          COALESCE(st.adjusted_stopped_at,st.stopped_at,
            CASE WHEN NOT st.is_active THEN st.started_at+st.elapsed_seconds*interval '1 second' END) AS ended
        FROM sub_timers st JOIN cohort j ON j.id=st.job_id WHERE st.tenant_id=${tenantId}
      ), timer_cost AS (
        SELECT t.id,t.job_id,t.user_id,t.is_active,
          CASE WHEN t.is_active THEN 0 ELSE GREATEST(0,EXTRACT(EPOCH FROM(t.ended-t.began))) END AS seconds,
          COALESCE(SUM(CASE WHEN r.value IS NOT NULL THEN
            GREATEST(0,EXTRACT(EPOCH FROM(LEAST(t.ended,COALESCE(r.next_at,t.ended))-GREATEST(t.began,r.effective_at)))) ELSE 0 END),0) AS covered,
          COALESCE(SUM(CASE WHEN r.value IS NOT NULL THEN
            GREATEST(0,EXTRACT(EPOCH FROM(LEAST(t.ended,COALESCE(r.next_at,t.ended))-GREATEST(t.began,r.effective_at))))/3600.0*r.value ELSE 0 END),0) AS cost
        FROM timer_base t LEFT JOIN LATERAL (
          SELECT pr.value,pr.effective_at,lead(pr.effective_at) OVER(ORDER BY pr.effective_at,pr.id) AS next_at
          FROM payroll_rates pr WHERE pr.tenant_id=${tenantId} AND pr.source='hourly'
            AND pr.source_id=t.user_id AND pr.effective_at<t.ended
        ) r ON NOT t.is_active
        GROUP BY t.id,t.job_id,t.user_id,t.is_active,t.began,t.ended
      ), workers AS (
        SELECT t.job_id,t.user_id,u.name,SUM(t.seconds)/60.0 AS minutes,
          SUM(t.cost) AS known_cost,
          CASE WHEN bool_or(t.is_active) OR SUM(t.seconds)<=0 OR SUM(t.covered)<SUM(t.seconds)-0.001
            THEN NULL ELSE SUM(t.cost) END AS cost,bool_or(t.is_active) AS open
        FROM timer_cost t LEFT JOIN users u ON u.id=t.user_id AND u.tenant_id=${tenantId}
        GROUP BY t.job_id,t.user_id,u.name
      ), labor AS (
        SELECT job_id,SUM(minutes) AS minutes,bool_or(open) AS open,SUM(known_cost) AS known_cost,
          CASE WHEN bool_or(cost IS NULL) THEN NULL ELSE SUM(cost) END AS cost,
          jsonb_agg(jsonb_build_object('id',user_id,'name',COALESCE(name,'Employee'),'minutes',minutes,'cost',cost)) AS workers
        FROM workers GROUP BY job_id
      ), fuel AS (
        SELECT f.job_id,SUM(f.cost) AS cost FROM equipment_fuel_logs f JOIN cohort j ON j.id=f.job_id
          WHERE f.tenant_id=${tenantId} GROUP BY f.job_id
      ), costs AS (
        SELECT c.job_id,SUM(c.amount) FILTER(WHERE c.voided_at IS NULL) AS cost,
          jsonb_agg(jsonb_build_object('id',c.id,'description',c.description,'amount',c.amount,
            'expense_id',c.expense_id,'created_at',c.created_at,'created_by_name',c.created_by_name,
            'voided_at',c.voided_at,'void_reason',c.void_reason) ORDER BY c.id) AS entries
        FROM job_other_costs c JOIN cohort j ON j.id=c.job_id WHERE c.tenant_id=${tenantId} GROUP BY c.job_id
      )
      SELECT j.id,j.title,j.customer_id,j.service_id,j.total_amount,j.estimated_duration,j.line_items,
        j.job_parts,j.supplies_needed,j.report_baseline,(j.completed_at AT TIME ZONE ${tenant.timezone})::date::text AS completed_date,
        c.name AS customer_name,p.address AS property_address,
        jsonb_build_object('serviceableAreaSqft',p.serviceable_area_sqft,'measurementPolygons',p.measurement_polygons) AS property_data,
        jsonb_build_object('name',s.name,'pricingMode',s.pricing_mode,'pricingMatrix',s.pricing_matrix,'linkedZoneTypeId',s.linked_zone_type_id) AS service_data,
        l.minutes,l.open,l.cost AS labor_cost,l.known_cost AS known_labor_cost,l.workers,COALESCE(f.cost,0) AS fuel_cost,
        COALESCE(o.cost,0) AS other_cost,COALESCE(o.entries,'[]'::jsonb) AS other_costs,
        e.id AS estimate_id,e.subtotal AS estimate_subtotal,e.total AS estimate_total,e.tax AS estimate_tax,
        e.estimated_duration_min AS estimate_minutes
      FROM cohort j
      LEFT JOIN customers c ON c.id=j.customer_id AND c.tenant_id=${tenantId}
      LEFT JOIN properties p ON p.id=j.property_id AND p.tenant_id=${tenantId}
      LEFT JOIN services s ON s.tenant_id=${tenantId} AND (s.id=j.service_id OR (j.service_id IS NULL AND s.id::text=(
        SELECT CASE WHEN count(DISTINCT li->>'serviceId')=1 THEN min(li->>'serviceId') END
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.line_items)='array' THEN j.line_items ELSE '[]'::jsonb END) li
        WHERE li->>'serviceId' ~ '^[1-9][0-9]*$'
      )))
      LEFT JOIN labor l ON l.job_id=j.id LEFT JOIN fuel f ON f.job_id=j.id LEFT JOIN costs o ON o.job_id=j.id
      LEFT JOIN LATERAL (SELECT id,subtotal,total,tax,estimated_duration_min FROM estimates
        WHERE tenant_id=${tenantId} AND converted_to_job_id=j.id AND customer_id=j.customer_id ORDER BY id LIMIT 1) e ON true
      ORDER BY j.completed_at DESC,j.id DESC
    `),
    db.execute(sql`SELECT DISTINCT c.id,c.name FROM jobs j JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id
      WHERE j.tenant_id=${tenantId} AND j.status='completed' AND j.completed_at>=${start} AND j.completed_at<${end} ORDER BY c.name,c.id`),
    db.execute(sql`SELECT id,name FROM services WHERE tenant_id=${tenantId} ORDER BY name,id`),
  ]);
  if (data.rows.length>10000) {res.status(422).json({error:"More than 10,000 jobs match. Choose a shorter date range or filter by customer or service; no partial totals were returned."});return;}
  const serviceNames=new Map(services.rows.map(s=>[Number(s.id),String(s.name)]));
  const jobs=data.rows.map(r=>{
    const baseline=record(r.report_baseline), frozen=baseline.version===1;
    const service=frozen?record(baseline.service):record(r.service_data);
    const property=frozen?baseline.property:r.property_data;
    const measured=jobMeasurement(service,property,frozen?baseline.zones:tenant.zones);
    const serviceIds=[...new Set([r.service_id,...array(r.line_items).map(li=>record(li).serviceId)]
      .map(finite).filter((n):n is number=>n!==null&&Number.isInteger(n)&&n>0))];
    const serviceId=finite(r.service_id)??(serviceIds.length===1?serviceIds[0]:null);
    const multiService=serviceIds.length>1;
    if (multiService) {
      measured.measurement=null;
      measured.measurementUnit=null;
      measured.matrixLabel="Unallocated across services";
    }
    const actualServiceName = String(service.name ?? serviceNames.get(serviceId!) ?? "Unspecified service");
    const {materials,materialCost}=materialBreakdown(r.job_parts,r.supplies_needed);
    const minutes=Number(r.minutes??0), hasOpenTimers=Boolean(r.open);
    const laborCost=hasOpenTimers||minutes<=0?null:finite(r.labor_cost);
    const fuelCost=money(Number(r.fuel_cost)),otherCost=money(Number(r.other_cost));
    const tax=finite(baseline.taxAmount)??(r.estimate_id!=null&&Math.abs(Number(r.total_amount)-Number(r.estimate_total))<0.005?Number(r.estimate_tax):0);
    const revenue=money(Number(r.total_amount)-tax);
    const issues:string[]=[];
    if (revenue<=0) issues.push("No positive job price recorded. Confirm whether this is intentionally no-charge work or still needs pricing before using the contribution figure.");
    if (!frozen) issues.push("Original estimate and measurement snapshot not saved; current job/linked estimate values and current property/matrix are labeled, not historical evidence.");
    if (laborCost===null) issues.push(hasOpenTimers?"Job has an open timer; labor cost and profit are incomplete.":minutes<=0?"No completed job time recorded.":"Historical hourly rate missing for some recorded time.");
    if (materialCost===null) issues.push("Inventory purchase-cost snapshot or planned supply usage is missing.");
    if (multiService) issues.push("Multiple services share job-level time/cost; kept in an unallocated group, not duplicated across services.");
    if (measured.measurement===null) issues.push("No usable service measurement; excluded from per-unit comparisons.");
    else if (!service.linkedZoneTypeId) issues.push("Measurement uses total enabled property area/length; no service-specific zone is linked.");
    const totals=reportCostTotals(laborCost===null?null:money(laborCost),materialCost,fuelCost,otherCost,revenue,
      Number(r.known_labor_cost??0),materials.reduce((sum,p)=>sum+(p.cost??0),0));
    return {
      id:Number(r.id),title:String(r.title),customerId:finite(r.customer_id),customerName:String(r.customer_name??"No customer"),
      propertyAddress:r.property_address==null?null:String(r.property_address),serviceId,serviceIds,
      serviceName:multiService?"Multiple services — unallocated":actualServiceName,
      completedDate:String(r.completed_date),...measured,
      measurementSource:measured.measurement!==null?(frozen?"snapshot" as const:"current_property" as const)
        :measured.pricingMode==="flat"?"not_applicable" as const:"missing" as const,
      revenue,budgetRevenue:frozen?finite(baseline.budgetRevenue):finite(r.estimate_subtotal)??finite(r.total_amount),
      budgetMinutes:frozen?finite(baseline.budgetMinutes):finite(r.estimate_minutes)??finite(r.estimated_duration),
      budgetMaterialCost:frozen?finite(baseline.budgetMaterialCost):null,
      budgetLaborCost:frozen?finite(baseline.budgetLaborCost):null,
      baselineSource:frozen?String(baseline.source):r.estimate_id!=null?"Linked estimate (current; not frozen)":"Current job budget (not frozen)",
      estimateId:finite(baseline.estimateId)??finite(r.estimate_id),minutes,hasOpenTimers,
      laborCost:laborCost===null?null:money(laborCost),materialCost,fuelCost,otherCost,...totals,multiService,materials,
      workers:array(r.workers).map(w=>{const x=record(w);return {id:Number(x.id),name:String(x.name),minutes:Number(x.minutes),cost:finite(x.cost)===null?null:money(Number(x.cost))};}),
      otherCosts:array(r.other_costs).map(c=>costOutput(record(c))),issues,
    };
  });
  const historicalServiceChoices=new Map(services.rows.map(s=>[Number(s.id),String(s.name)]));
  for (const job of jobs) for (const serviceId of job.serviceIds) {
    if (!historicalServiceChoices.has(serviceId)) historicalServiceChoices.set(serviceId,job.multiService?`Service #${serviceId} (historical)`:job.serviceName);
  }
  res.json(GetJobEconomicsReportResponse.parse({from,to,timezone:tenant.timezone,generatedAt:new Date().toISOString(),jobs,
    customers:customers.rows.map(c=>({id:Number(c.id),name:String(c.name)})),
    services:[...historicalServiceChoices].map(([id,name])=>({id,name})),
    notes:[
      "Completion dates use company timezone. Person-minutes sum every worker's completed job timers, including owners and adjusted time; master-clock time is not counted again.",
      "Labor cost uses effective historical hourly rates, split when a rate changes during a timer. It is not finalized P4P payroll, employer taxes or payroll burden.",
      "Contribution is job price less recorded hourly labor, frozen inventory purchase cost, directly linked fuel and additional job allocations. It is before overhead, P4P top-ups and unallocated fleet/equipment costs; it is not net accounting profit.",
      "Invoice totals are never copied onto each job. Saved estimate tax is removed where available; standalone job prices are entered service values. Invoice-level discounts and adjustments are not allocated here.",
      "No recorded linked fuel/other cost means zero recorded allocations, not proof there were no physical costs. Supply receipts are counted when used, not again when purchased.",
      "New estimates freeze planned inventory costs when the supply plan is saved. Scheduling snapshots freeze future job budgets, assigned-worker hourly assumptions and measurements. Labor forecasts use the assigned workers' average hourly rate and budget person-minutes at scheduling. Older jobs/quotes are not backfilled with invented historical costs. Legacy matrix groups use current measurements and current tier rules.",
      "Per-unit comparisons require matching measured cohorts and compatible units. Multi-service job totals are unallocated unless job-level service attribution exists.",
    ],
  }));
});

const costInput=z.object({
  description:z.string().trim().min(1).max(300),
  amount:z.number().positive().max(1_000_000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001,"Use dollars and cents"),
  requestId:z.string().min(8).max(100),
  expenseId:z.number().int().positive().max(2147483647).nullable().optional(),
}).strict();
class CostConflict extends Error { constructor(message:string,public status=409){super(message);} }

router.post("/reports/job-economics/:jobId/costs",async(req,res)=>{
  const jobId=id(req.params.jobId),tenantId=getTenantId(req),userId=getUserId(req),parsed=costInput.safeParse(req.body);
  if(!jobId||!parsed.success){res.status(400).json({error:"Enter a description, positive dollar amount with two decimals, and request ID"});return;}
  const input=parsed.data, fingerprint=JSON.stringify({jobId,description:input.description,amount:input.amount,expenseId:input.expenseId??null});
  try {
    const row=await db.transaction(async tx=>{
      // One tenant lock serializes request IDs and allocations, including voids.
      await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR UPDATE`);
      const job=await tx.execute(sql`SELECT id FROM jobs WHERE id=${jobId} AND tenant_id=${tenantId}`);
      if(!job.rows.length)throw new CostConflict("Job not found",404);
      const prior=await tx.execute(sql`SELECT id,description,amount,expense_id,created_at,created_by_name,voided_at,void_reason,request_fingerprint
        FROM job_other_costs WHERE tenant_id=${tenantId} AND request_id=${input.requestId}`);
      if(prior.rows[0]){
        if(prior.rows[0].request_fingerprint!==fingerprint)throw new CostConflict("Request ID already used for a different cost");
        return prior.rows[0];
      }
      if(input.expenseId){
        const expense=await tx.execute(sql`SELECT amount,category,inventory_receipts FROM expense_entries WHERE id=${input.expenseId} AND tenant_id=${tenantId} FOR UPDATE`);
        const e=expense.rows[0];
        if(!e)throw new CostConflict("Expense not found",404);
        if(array(e.inventory_receipts).length||/fuel|suppl|material/i.test(String(e.category)))
          throw new CostConflict("Do not allocate inventory purchases or fuel expenses again; their job usage is already reported");
        const allocated=await tx.execute(sql`SELECT COALESCE(sum(amount),0) AS total FROM job_other_costs
          WHERE tenant_id=${tenantId} AND expense_id=${input.expenseId} AND voided_at IS NULL`);
        if(Number(allocated.rows[0].total)+input.amount>Number(e.amount)+0.005)
          throw new CostConflict("Allocations would exceed this vendor expense");
      }
      const actor=await tx.execute(sql`SELECT name FROM users WHERE id=${userId} AND tenant_id=${tenantId}`);
      const created=await tx.execute(sql`INSERT INTO job_other_costs
        (tenant_id,job_id,description,amount,expense_id,request_id,request_fingerprint,created_by,created_by_name)
        VALUES(${tenantId},${jobId},${input.description},${input.amount},${input.expenseId??null},${input.requestId},${fingerprint},${userId},${String(actor.rows[0]?.name??"Staff")})
        RETURNING id,description,amount,expense_id,created_at,created_by_name,voided_at,void_reason`);
      return created.rows[0];
    });
    res.status(201).json(costOutput(row));
  }catch(error){if(error instanceof CostConflict){res.status(error.status).json({error:error.message});return;}throw error;}
});
router.post("/reports/job-economics/:jobId/costs/:costId/void",async(req,res)=>{
  const jobId=id(req.params.jobId),costId=id(req.params.costId),tenantId=getTenantId(req);
  const parsed=z.object({reason:z.string().trim().min(1).max(1000)}).strict().safeParse(req.body);
  if(!jobId||!costId||!parsed.success){res.status(400).json({error:"Choose a cost and enter a void reason"});return;}
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR UPDATE`);
    return tx.execute(sql`UPDATE job_other_costs SET voided_at=now(),voided_by=${getUserId(req)},void_reason=${parsed.data.reason}
      WHERE id=${costId} AND job_id=${jobId} AND tenant_id=${tenantId} AND voided_at IS NULL
      RETURNING id,description,amount,expense_id,created_at,created_by_name,voided_at,void_reason`);
  });
  if(!result.rows[0]){res.status(409).json({error:"Cost is not available or was already voided"});return;}
  res.json(costOutput(result.rows[0]));
});
export default router;
