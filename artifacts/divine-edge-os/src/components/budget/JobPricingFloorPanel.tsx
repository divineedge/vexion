import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Download, Info } from 'lucide-react';
import {
  JobPricingFloorInputs, calculateJobPricingFloor, defaultJobPricingFloor,
} from '@/lib/jobPricingFloor';

export type JobPricingFloorDraft = Record<keyof JobPricingFloorInputs, string>;

export const draftFromInputs = (i: JobPricingFloorInputs): JobPricingFloorDraft =>
  Object.fromEntries(Object.entries(i).map(([k, v]) => [k, String(v)])) as JobPricingFloorDraft;

/** Blank or non-numeric entries become NaN so the shared module reports them as errors. */
export const parseDraft = (d: JobPricingFloorDraft): JobPricingFloorInputs =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v)])) as unknown as JobPricingFloorInputs;

const FIELDS: { key: keyof JobPricingFloorInputs; label: string; unit: string; prefix?: boolean; step?: string; hint: string }[] = [
  { key: 'hourlyWage', label: 'Hourly wage per crew member', unit: '$/hr', prefix: true, hint: 'Base pay for one person before taxes and insurance.' },
  { key: 'payrollBurdenPct', label: 'Payroll burden', unit: '%', hint: 'Payroll taxes, workers comp and benefits as a percent of wage. Typical starting point: 15%.' },
  { key: 'crewMembers', label: 'Crew members on the stop', unit: 'people', step: '1', hint: 'Every crew member is paid for on-site plus drive and setup time.' },
  { key: 'monthlyOverhead', label: 'Monthly overhead', unit: '$/mo', prefix: true, hint: 'Rent, insurance, trucks, software, office pay for this company or division scope.' },
  { key: 'monthlyBillableHours', label: 'Monthly billable crew hours', unit: 'crew hrs/mo', hint: 'TOTAL on-site crew clock-hours in this cost scope. A 3-person crew on site for 1 hour counts as 1 crew hour, not 3 man-hours. Exclude drive and shop time.' },
  { key: 'onSiteMinutes', label: 'On-site time', unit: 'min', hint: 'Crew clock minutes at the property doing the work.' },
  { key: 'driveSetupMinutes', label: 'Drive and setup time', unit: 'min', hint: 'Travel, loading and unloading charged to this stop. Paid labor, no overhead added.' },
  { key: 'targetMarginPct', label: 'Target profit margin', unit: '%', hint: 'Profit as a share of the price (not markup on cost). Must be under 100%.' },
  { key: 'directJobCosts', label: 'Other direct job costs', unit: '$/stop', prefix: true, hint: 'Optional: materials, fuel, dump fees used on this stop and not already in overhead.' },
];

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function JobPricingFloorPanel({ draft, onChange, isDefault }: {
  draft: JobPricingFloorDraft;
  onChange: (next: JobPricingFloorDraft) => void;
  isDefault: boolean;
}) {
  const { errors, result } = calculateJobPricingFloor(parseDraft(draft));
  const downloadHref = `${import.meta.env.BASE_URL}job-pricing-floor.html`;

  return (
    <div className="space-y-4" data-testid="panel-job-pricing-floor">
      <div className="rounded-lg border border-emerald-900/20 bg-emerald-950/[0.03] p-4 text-sm flex gap-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-emerald-800" />
        <div className="space-y-1">
          <p className="font-medium text-emerald-950 dark:text-emerald-100">The lowest price a single stop can carry without losing money.</p>
          <p className="text-muted-foreground">
            Separate from the annual man-hour rates on division tabs. Changes calculate instantly; click Save Budget to keep this scenario with the {''}
            year's budget.
          </p>
          {isDefault && (
            <p className="text-amber-800 dark:text-amber-300 font-medium" data-testid="text-jpf-example-notice">
              Values shown are example assumptions only, not your business financials. Replace them with your numbers.
            </p>
          )}
          <a href={downloadHref} download="job-pricing-floor.html" data-testid="link-jpf-download"
            className="inline-flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-medium hover:underline budget-print-controls">
            <Download className="w-3.5 h-3.5" /> Download standalone calculator
          </a>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stop scenario</CardTitle>
            <CardDescription>Inputs for one typical stop in this cost scope.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(f => (
              <div key={f.key} className={`space-y-1 ${f.key === 'monthlyBillableHours' ? 'sm:col-span-2' : ''}`}>
                <label htmlFor={`jpf-${f.key}`} className="text-xs font-medium text-foreground/80 flex justify-between gap-2">
                  <span>{f.label}</span><span className="text-muted-foreground font-normal">{f.unit}</span>
                </label>
                <div className="relative">
                  {f.prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>}
                  <Input id={`jpf-${f.key}`} data-testid={`input-jpf-${f.key}`} type="number" inputMode="decimal"
                    min={f.key === 'crewMembers' ? 1 : 0} step={f.step ?? 'any'}
                    value={draft[f.key]} onChange={e => onChange({ ...draft, [f.key]: e.target.value })}
                    className={`tabular-nums focus-visible:ring-emerald-800 ${f.prefix ? 'pl-7' : ''}`} />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-4">
          {!result ? (
            <Card className="border-amber-600/40" data-testid="status-jpf-errors">
              <CardContent className="p-5 space-y-2">
                <p className="font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4" /> Fix these entries to see a price floor
                </p>
                <ul className="text-sm list-disc pl-5 space-y-1">{errors.map(e => <li key={e}>{e}</li>)}</ul>
                <p className="text-xs text-muted-foreground">Save Budget is disabled until the scenario is valid.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="rounded-xl bg-emerald-900 text-emerald-50 p-6 shadow-sm">
                <p className="text-xs uppercase tracking-wider text-emerald-200/80">Recommended minimum per stop</p>
                <p className="text-5xl font-bold tabular-nums mt-1" data-testid="metric-jpf-recommendedMinimum">{money(result.recommendedMinimum)}</p>
                <p className="text-sm text-emerald-100/80 mt-2">
                  {draft.targetMarginPct}% profit margin on price, {money(result.profitAtMinimum)} profit per stop
                  <span className="sr-only" data-testid="metric-jpf-profitAtMinimum">{result.profitAtMinimum.toFixed(2)}</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Metric id="breakEvenFloor" label="Break-even floor" value={money(Math.ceil(result.breakEvenFloor * 100 - 1e-8) / 100)} sub="Zero-profit price, rounded up to a cent" strong />
                <Metric id="trueHourlyCost" label="True hourly cost" value={money(result.trueHourlyCost)} sub="Full stop cost per on-site hour (includes travel labor and direct costs)" strong />
                <Metric id="costPerClockMinute" label="Cost per clock minute" value={money(result.costPerClockMinute)} sub="Per on-site + drive minute" />
                <Metric id="revenuePerClockMinute" label="Target revenue per clock minute" value={money(result.revenuePerClockMinute)} sub="Per on-site + drive minute" />
                <Metric id="totalClockMinutes" label="Total clock minutes" value={`${result.totalClockMinutes} min`} sub="On-site plus drive and setup" />
                <Metric id="burdenedWage" label="Burdened wage" value={`${money(result.burdenedWage)}/hr`} sub={`Crew labor ${money(result.crewLaborHourly)}/hr`} />
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Cost breakdown per stop</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1.5 tabular-nums">
                  <Row id="laborCost" label={`Crew labor (${result.totalClockMinutes} paid min)`} value={money(result.laborCost)} />
                  <Row id="overheadShare" label={`Overhead (${money(result.overheadPerBillableHour)}/on-site hr)`} value={money(result.overheadShare)} />
                  <Row id="directJobCosts" label="Other direct job costs" value={money(result.directJobCosts)} />
                  <div className="border-t pt-1.5"><Row id="breakEvenTotal" label="Break-even floor (rounded up)" value={money(Math.ceil(result.breakEvenFloor * 100 - 1e-8) / 100)} bold /></div>
                  <Row id="profit" label="Profit at recommended minimum" value={money(result.profitAtMinimum)} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ id, label, value, sub, strong }: { id: string; label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 bg-card ${strong ? 'border-emerald-800/40' : ''}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${strong ? 'text-emerald-900 dark:text-emerald-300' : ''}`} data-testid={`metric-jpf-${id}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</p>
    </div>
  );
}

function Row({ id, label, value, bold }: { id: string; label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span><span data-testid={`metric-jpf-row-${id}`}>{value}</span>
    </div>
  );
}

export const isDefaultScenario = (d: JobPricingFloorDraft) => {
  const def = draftFromInputs(defaultJobPricingFloor());
  return (Object.keys(def) as (keyof JobPricingFloorInputs)[]).every(k => d[k] === def[k]);
};
