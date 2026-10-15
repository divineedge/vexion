import type { JobEconomicsJob } from '@workspace/api-client-react';

export const MAX_REPORT_DAYS = 731;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString?.().slice(0, 10) === s;
export function validateEconomicsRange(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both a start and end date.';
  try { if (!validDate(from) || !validDate(to)) return 'Choose valid start and end dates.'; } catch { return 'Choose valid start and end dates.'; }
  if (from > to) return 'Start date must be on or before end date.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_REPORT_DAYS) return 'Date range can span at most two years.';
  return null;
}

/** serviceId: null = all, 0 = unspecified, >0 = primary or constituent service. */
export interface EconomicsFilter { customerId: number | null; serviceId: number | null }
export function filterJobs(jobs: JobEconomicsJob[], f: EconomicsFilter): JobEconomicsJob[] {
  return jobs.filter(j => {
    if (f.customerId != null && j.customerId !== f.customerId) return false;
    if (f.serviceId == null) return true;
    if (f.serviceId === 0) return j.serviceId == null && (j.serviceIds?.length ?? 0) === 0;
    return j.serviceId === f.serviceId || (j.serviceIds ?? []).includes(f.serviceId);
  });
}

export const isTimed = (j: JobEconomicsJob) => !j.hasOpenTimers && j.minutes > 0;
export const isCostComplete = (j: JobEconomicsJob) => j.totalCost != null;
export const CURRENT_LABEL = 'Current property / matrix; historical size not saved';

export type GroupMode = 'service' | 'matrix';
export interface UnitStats { measured: number; costCohort: number; priceCohort: number; timeCohort: number; costPerUnit: number | null; pricePerUnit: number | null; minutesPerUnit: number | null }
export interface GroupRow {
  key: string; label: string; sub: string | null; kind: 'service' | 'multi' | 'unspecified';
  jobs: JobEconomicsJob[]; jobCount: number; timedCount: number; openTimerCount: number;
  avgMinutes: number | null; personHours: number; revenue: number;
  costCompleteCount: number; knownCost: number; completeCost: number | null; completeRevenue: number | null;
  contribution: number | null; marginPct: number | null;
  sqft: UnitStats; linear: UnitStats;
}

function unitStats(jobs: JobEconomicsJob[], unit: 'sqft' | 'linear_ft'): UnitStats {
  const m = jobs.filter(j => !j.multiService && j.measurementUnit === unit && j.measurement != null && j.measurement > 0);
  const cc = m.filter(isCostComplete), pr = m.filter(j => j.revenue > 0), tm = m.filter(isTimed);
  const sum = (a: JobEconomicsJob[], f: (j: JobEconomicsJob) => number) => a.reduce((s, j) => s + f(j), 0);
  const ratio = (a: JobEconomicsJob[], f: (j: JobEconomicsJob) => number) => { const d = sum(a, j => j.measurement as number); return a.length && d > 0 ? sum(a, f) / d : null; };
  return { measured: m.length, costCohort: cc.length, priceCohort: pr.length, timeCohort: tm.length,
    costPerUnit: ratio(cc, j => j.totalCost as number), pricePerUnit: ratio(pr, j => j.revenue), minutesPerUnit: ratio(tm, j => j.minutes) };
}

export function groupKeyOf(j: JobEconomicsJob, mode: GroupMode): { key: string; label: string; sub: string | null; kind: GroupRow['kind'] } {
  const base = j.multiService ? { key: 'multi', label: 'Multiple services — unallocated', kind: 'multi' as const }
    : j.serviceId == null ? { key: 'unspecified', label: 'Unspecified service', kind: 'unspecified' as const }
    : { key: `svc:${j.serviceId}`, label: j.serviceName || `Service #${j.serviceId}`, kind: 'service' as const };
  if (mode === 'service') return { ...base, sub: null };
  const src = j.measurementSource === 'current_property' ? 'current' : j.measurementSource === 'snapshot' ? 'snapshot' : j.measurementSource;
  const tier = j.matrixLabel || 'No matrix tier';
  const unit = j.measurementUnit === 'sqft' ? 'sq ft' : j.measurementUnit === 'linear_ft' ? 'linear ft' : 'no unit';
  const srcLabel = src === 'current' ? CURRENT_LABEL : src === 'snapshot' ? 'Saved job snapshot' : src === 'missing' ? 'Measurement missing' : 'Not measured';
  return { key: `${base.key}|${tier}|${j.measurementUnit ?? ''}|${src}`, label: base.label, sub: `${tier} · ${unit} · ${srcLabel}`, kind: base.kind };
}

export function buildGroups(jobs: JobEconomicsJob[], mode: GroupMode): GroupRow[] {
  const map = new Map<string, { meta: ReturnType<typeof groupKeyOf>; jobs: JobEconomicsJob[] }>();
  for (const j of jobs) { const meta = groupKeyOf(j, mode); const g = map.get(meta.key); if (g) g.jobs.push(j); else map.set(meta.key, { meta, jobs: [j] }); }
  return [...map.values()].map(({ meta, jobs: js }) => {
    const timed = js.filter(isTimed), cc = js.filter(isCostComplete);
    const completeCost = cc.length ? cc.reduce((s, j) => s + (j.totalCost as number), 0) : null;
    const completeRevenue = cc.length ? cc.reduce((s, j) => s + j.revenue, 0) : null;
    const contribution = completeCost != null && completeRevenue != null ? completeRevenue - completeCost : null;
    const tMin = timed.reduce((s, j) => s + j.minutes, 0);
    return { ...meta, jobs: js, jobCount: js.length, timedCount: timed.length, openTimerCount: js.filter(j => j.hasOpenTimers).length,
      avgMinutes: timed.length ? tMin / timed.length : null, personHours: js.reduce((sum,j)=>sum+j.minutes,0) / 60,
      revenue: js.reduce((s, j) => s + j.revenue, 0), costCompleteCount: cc.length, knownCost: js.reduce((s, j) => s + j.knownCost, 0),
      completeCost, completeRevenue, contribution,
      marginPct: contribution != null && completeRevenue ? (contribution / completeRevenue) * 100 : null,
      sqft: unitStats(js, 'sqft'), linear: unitStats(js, 'linear_ft') };
  }).sort((a, b) => (a.kind === 'service' ? 0 : 1) - (b.kind === 'service' ? 0 : 1) || b.revenue - a.revenue || a.label.localeCompare(b.label));
}

export type AreaDisplay = 'k_sqft' | 'acre';
export const areaFactor = (d: AreaDisplay) => (d === 'acre' ? 43560 : 1000);
export const areaLabel = (d: AreaDisplay) => (d === 'acre' ? 'acre' : '1,000 sq ft');

export const fmtMoney = (v: number | null | undefined, empty = 'Not recorded') =>
  v == null || !Number.isFinite(v) ? empty : v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMin = (v: number | null | undefined, empty = 'Not recorded') =>
  v == null || !Number.isFinite(v) ? empty : `${Math.round(v).toLocaleString()} min`;
export const fmtPct = (v: number | null | undefined, empty = 'Incomplete') =>
  v == null || !Number.isFinite(v) ? empty : `${v.toFixed(1)}%`;
export const fmtNum = (v: number | null | undefined, d = 2, empty = '—') =>
  v == null || !Number.isFinite(v) ? empty : v.toLocaleString(undefined, { maximumFractionDigits: d });

/** Budgeted total cost only when both labor and material baselines are saved. */
export const budgetTotalCost = (j: JobEconomicsJob) => (j.budgetLaborCost != null && j.budgetMaterialCost != null ? j.budgetLaborCost + j.budgetMaterialCost : null);
export const overTime = (j: JobEconomicsJob) => j.budgetMinutes != null && j.budgetMinutes > 0 && isTimed(j) && j.minutes > j.budgetMinutes;
export const overCost = (j: JobEconomicsJob) => { const b = budgetTotalCost(j); return b != null && j.totalCost != null && j.totalCost > b; };

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const n = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'Not recorded' : Number(v.toFixed(d)));

export function jobsCsv(jobs: JobEconomicsJob[], header: string[][]): string {
  return toCsv([...header, [], ['Job ID', 'Completed', 'Title', 'Customer', 'Service', 'Multi-service', 'Matrix tier', 'Measurement', 'Unit', 'Measurement source', 'Revenue', 'Budget revenue', 'Baseline source', 'Estimate ID', 'Budget minutes', 'Actual minutes', 'Open timers', 'Labor cost', 'Material cost', 'Fuel cost', 'Other cost', 'Known cost', 'Total cost', 'Contribution (before overhead)', 'Margin %', 'Coverage issues', 'Job link', 'Estimate link'],
    ...jobs.map(j => [j.id, j.completedDate, j.title, j.customerName, j.serviceName, j.multiService ? 'yes' : 'no', j.matrixLabel, n(j.measurement), j.measurementUnit ?? '', j.measurementSource, n(j.revenue), n(j.budgetRevenue), j.baselineSource, j.estimateId ?? '', n(j.budgetMinutes, 0), j.minutes, j.hasOpenTimers ? 'yes' : 'no', n(j.laborCost), n(j.materialCost), n(j.fuelCost), n(j.otherCost), n(j.knownCost), j.totalCost == null ? 'Incomplete' : n(j.totalCost), j.profit == null ? 'Incomplete' : n(j.profit), j.marginPct == null ? 'Incomplete' : n(j.marginPct, 1), j.issues.join('; '), `/schedule?jobId=${j.id}`, j.estimateId != null ? `/estimates?estimateId=${j.estimateId}` : ''])]);
}
export function groupsCsv(groups: GroupRow[], header: string[][], area: AreaDisplay): string {
  const f = areaFactor(area);
  const s = (v: number | null, mul: number) => (v == null ? 'Not enough data' : Number((v * mul).toFixed(2)));
  return toCsv([...header, ['Cohorts', 'Cost/unit = measured AND cost-complete jobs; price/unit = measured jobs with revenue > 0; time/unit = measured timed jobs without open timers. Area (sq ft) and linear ft are separate and never summed. Multi-service jobs are an unallocated group.'], ['Area display', `per ${areaLabel(area)}`], [], ['Group', 'Matrix / unit / measurement source', 'Jobs', 'Timed jobs', 'Jobs with open timers', 'Avg person-min per timed job', 'Person-hours', 'Revenue', 'Cost-complete jobs', 'Known cost (all jobs)', 'Cost (cost-complete)', 'Revenue (cost-complete)', 'Contribution before overhead', 'Margin %',
    'Area measured jobs', `Cost per ${areaLabel(area)}`, 'Area cost cohort', `Price per ${areaLabel(area)}`, 'Area price cohort', `Minutes per ${areaLabel(area)}`, 'Area time cohort',
    'Linear measured jobs', 'Cost per linear ft', 'Linear cost cohort', 'Price per linear ft', 'Linear price cohort', 'Minutes per linear ft', 'Linear time cohort'],
    ...groups.map(g => [g.label, g.sub ?? '', g.jobCount, g.timedCount, g.openTimerCount, n(g.avgMinutes, 1), n(g.personHours), n(g.revenue), g.costCompleteCount, n(g.knownCost), n(g.completeCost), n(g.completeRevenue), g.contribution == null ? 'Incomplete' : n(g.contribution), g.marginPct == null ? 'Incomplete' : n(g.marginPct, 1),
      g.sqft.measured, s(g.sqft.costPerUnit, f), g.sqft.costCohort, s(g.sqft.pricePerUnit, f), g.sqft.priceCohort, s(g.sqft.minutesPerUnit, f), g.sqft.timeCohort,
      g.linear.measured, s(g.linear.costPerUnit, 1), g.linear.costCohort, s(g.linear.pricePerUnit, 1), g.linear.priceCohort, s(g.linear.minutesPerUnit, 1), g.linear.timeCohort])]);
}
