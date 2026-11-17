import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { JobPricingFloorInputs, calculateJobPricingFloor } from '@/lib/jobPricingFloor';
import { BUDGET_LINKED_FLOOR_KEYS, SCENARIO_SEED_KEYS, presentFloorInputs } from '@/lib/jobPricingFloorBaseline';
import { FIELDS, JobPricingFloorDraft, draftFromInputs, parseDraft, money, useOnSiteTimeField } from './JobPricingFloorPanel';
import {
  BudgetInfoButton, RecommendedMinimumInfo, StopBreakEvenInfo, StopDirectInfo, StopLaborInfo,
  StopOverheadInfo, StopTrueHourlyInfo,
} from './BudgetNumbersInfo';

/**
 * Compact stop-floor calculator bound to one budget scope (a division or the
 * company). Mount with a key per year+scope so drafts never mix.
 * `saved` undefined means the scenario follows the budget-derived baseline live.
 */
export function ScopedJobPricingFloor({ scopeId, scopeLabel, saved, baseline, onChange, baselineNote }: {
  scopeId: string;
  scopeLabel: string;
  saved: JobPricingFloorInputs | undefined;
  baseline: JobPricingFloorInputs;
  onChange: (next: JobPricingFloorInputs | undefined) => void;
  baselineNote: string;
}) {
  const [session, setSession] = useState<Partial<JobPricingFloorInputs>>({});
  const live = presentFloorInputs(baseline, saved, session);
  const shown = draftFromInputs(live);
  const { errors, result } = calculateJobPricingFloor(live);
  const followsBudget = !saved && Object.keys(session).length === 0;
  const baseDraft = draftFromInputs(baseline);

  const edit = (key: keyof JobPricingFloorInputs, next: JobPricingFloorDraft) => {
    const parsed = parseDraft(next);
    const patch: Partial<JobPricingFloorInputs> = { ...session, [key]: parsed[key] };
    // A budget field edited back to the live budget value stops being an override.
    if (BUDGET_LINKED_FLOOR_KEYS.includes(key) && parsed[key] === baseline[key]) delete patch[key];
    setSession(patch);
    const merged = presentFloorInputs(baseline, saved, patch);
    if (calculateJobPricingFloor(merged).result) onChange(merged);
  };
  const reset = () => { setSession({}); onChange(undefined); };
  const onSiteField = useOnSiteTimeField(shown.onSiteMinutes, minutes => {
    edit('onSiteMinutes', { ...shown, onSiteMinutes: String(minutes) });
  });
  const breakEven = result ? money(Math.ceil(result.breakEvenFloor * 100 - 1e-8) / 100) : '';

  return (
    <div className="space-y-4 pt-2" data-testid={`panel-jpf-${scopeId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 text-xs">
        <p className="text-muted-foreground max-w-xl leading-snug">
          {followsBudget
            ? <>Following {scopeLabel}'s budget. {baselineNote} Edit any value to keep a custom scenario for {scopeLabel}; click Save Budget to store it.</>
            : <>Custom scenario for {scopeLabel}. Valid edits are kept with this year's budget when you click Save Budget.</>}
        </p>
        {!followsBudget && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={reset} data-testid={`button-jpf-reset-${scopeId}`}>
            <RotateCcw className="w-3 h-3" /> Reset to budget values
          </Button>
        )}
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {FIELDS.map(f => {
          const differs = shown[f.key] !== baseDraft[f.key];
          const onSite = f.key === 'onSiteMinutes';
          return (
            <div key={f.key} className="space-y-1">
              <label htmlFor={`jpf-${scopeId}-${f.key}`} className="text-xs font-medium text-foreground/80 flex justify-between gap-2">
                <span>{f.label}</span><span className="text-muted-foreground font-normal">{f.unit}</span>
              </label>
              <div className="relative">
                {f.prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>}
                <Input id={`jpf-${scopeId}-${f.key}`} data-testid={`input-jpf-${scopeId}-${f.key}`} type="number" inputMode="decimal"
                  min={f.key === 'crewMembers' ? 1 : 0} step={f.step ?? 'any'} title={f.hint}
                  value={onSite ? onSiteField.value : shown[f.key]}
                  onChange={e => onSite ? onSiteField.onChange(e.target.value) : edit(f.key, { ...shown, [f.key]: e.target.value })}
                  onBlur={onSite ? onSiteField.onBlur : undefined}
                  className={`h-9 tabular-nums focus-visible:ring-emerald-800 ${f.prefix ? 'pl-7' : ''}`} />
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {SCENARIO_SEED_KEYS.includes(f.key)
                  ? <span className="text-amber-800 dark:text-amber-300">Scenario input, no budget source{differs ? '' : ' (example default, edit for your stop)'}</span>
                  : f.key === 'monthlyBillableHours' && baseline.monthlyBillableHours <= 0
                    ? <span className="text-amber-800 dark:text-amber-300">Budget has no crew capacity; enter real crew hours</span>
                    : differs ? <>Budget value: {f.prefix ? '$' : ''}{baseDraft[f.key]}</> : 'From budget'}
              </p>
            </div>
          );
        })}
      </div>

      {!result ? (
        <div className="rounded-lg border border-amber-600/40 p-3 text-sm space-y-1" data-testid={`status-jpf-errors-${scopeId}`}>
          <p className="font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> Fix these entries to see a price floor</p>
          <ul className="list-disc pl-5 text-xs space-y-0.5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          <p className="text-[11px] text-muted-foreground">Until fixed, the last valid scenario is what gets saved.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="rounded-xl bg-emerald-900 text-emerald-50 p-4">
            <p className="text-[11px] uppercase tracking-wider text-emerald-200/80 inline-flex items-center gap-1">Recommended minimum per stop, {scopeLabel} <BudgetInfoButton id={`recommended-minimum-${scopeId}`} label="recommended minimum per stop" title="Recommended minimum per stop" tone="emerald"><RecommendedMinimumInfo /></BudgetInfoButton></p>
            <p className="text-3xl font-bold tabular-nums mt-1" data-testid={`metric-jpf-${scopeId}-recommendedMinimum`}>{money(result.recommendedMinimum)}</p>
            <p className="text-xs text-emerald-100/80 mt-1">{shown.targetMarginPct}% margin on price, {money(result.profitAtMinimum)} profit per stop</p>
          </div>
          <div className="rounded-xl border p-4 text-xs space-y-1 tabular-nums">
            <Row label={`Crew labor (${result.totalClockMinutes} paid min)`} value={money(result.laborCost)} info={<BudgetInfoButton id={`stop-labor-${scopeId}`} label="crew labor for the stop" title="Crew labor"><StopLaborInfo /></BudgetInfoButton>} />
            <Row label={`Overhead (${money(result.overheadPerBillableHour)}/crew hr on site)`} value={money(result.overheadShare)} info={<BudgetInfoButton id={`stop-overhead-${scopeId}`} label="overhead for the stop" title="Overhead for the stop"><StopOverheadInfo /></BudgetInfoButton>} />
            <Row label="Other direct job costs" value={money(result.directJobCosts)} info={<BudgetInfoButton id={`stop-direct-${scopeId}`} label="other direct job costs" title="Other direct job costs"><StopDirectInfo /></BudgetInfoButton>} />
            <div className="border-t pt-1"><Row label="Break-even floor" value={breakEven} bold info={<BudgetInfoButton id={`stop-breakeven-${scopeId}`} label="stop break-even floor" title="Break-even floor"><StopBreakEvenInfo /></BudgetInfoButton>} /></div>
            <Row label="True hourly cost (per on-site hr)" value={money(result.trueHourlyCost)} info={<BudgetInfoButton id={`stop-true-hourly-${scopeId}`} label="true hourly cost" title="True hourly cost"><StopTrueHourlyInfo /></BudgetInfoButton>} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, info }: { label: string; value: string; bold?: boolean; info?: ReactNode }) {
  return <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}><span className="text-muted-foreground inline-flex items-center gap-1">{label}{info}</span><span>{value}</span></div>;
}
