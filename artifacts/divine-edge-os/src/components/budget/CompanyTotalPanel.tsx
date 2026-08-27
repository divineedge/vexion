import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Building2, Package, Timer, Layers } from 'lucide-react';
import {
  BudgetYear, computeCompanyTotal, OverheadLineItems, OVERHEAD_CATEGORIES,
} from '@/lib/budgetCalc';
import { NumField, Section, ResultCard, $, pct } from './shared';
import { CheckupPanel } from './CheckupPanel';

export function CompanyTotalPanel({
  year, onOverrideChange, onCompanyCheckupChange,
}: {
  year: BudgetYear;
  onOverrideChange: (overrides: Partial<OverheadLineItems>) => void;
  onCompanyCheckupChange: (which: 'companyMidYearCheckup' | 'companyEndYearCheckup', c: BudgetYear['companyMidYearCheckup']) => void;
}) {
  const totals = useMemo(() => computeCompanyTotal(year), [year]);

  const setOverride = (key: keyof OverheadLineItems, val: number) => {
    onOverrideChange({ ...year.overheadOverrides, [key]: val });
  };
  const clearOverride = (key: keyof OverheadLineItems) => {
    const next = { ...year.overheadOverrides };
    delete next[key];
    onOverrideChange(next);
  };

  const budgetedForCheckup = useMemo(() => ({
    revenue: totals.combinedRequiredRevenue,
    laborCost: totals.combinedLaborCost,
    materialCost: totals.combinedMaterialCost,
    overheadByCategory: totals.overheadByCategory.map(o => ({ key: o.key, label: o.label, annual: o.effective })),
  }), [totals]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        {/* Per-division rate comparison */}
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground" /> Hourly Rate by Division</CardTitle>
            <CardDescription className="text-xs">Each division's own required rate vs. the blended company-wide rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {totals.rows.map(({ division, results }) => (
              <div key={division.id} className="flex items-center justify-between text-sm py-1">
                <span>{division.name}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{results.manHoursYear.toLocaleString()} man-hrs</span>
                  <span className="font-semibold text-foreground">{$(results.requiredHourlyRate, 2)}/hr</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Overhead rollup with override capability */}
        <Section title="Combined Overhead (editable)" icon={Building2}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            Each line defaults to the sum of every division's entry. If a cost is shared and got
            counted in more than one division (e.g. one insurance policy entered on two budgets),
            override it here with the real combined company total.
          </p>
          <div className="space-y-2">
            {totals.overheadByCategory.map(o => (
              <div key={o.key} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-48 shrink-0">{o.label}</span>
                <span className="text-xs text-muted-foreground w-24 shrink-0">auto: {$(o.auto)}</span>
                <div className="flex-1 max-w-[160px]">
                  <NumField
                    label=""
                    value={o.override ?? o.auto}
                    onChange={v => setOverride(o.key, v)}
                  />
                </div>
                {o.override !== undefined && (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => clearOverride(o.key)}
                  >
                    reset to auto
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm flex items-center justify-between">
            <span className="text-amber-800">Combined annual overhead</span>
            <span className="font-bold text-amber-900">{$(totals.combinedAnnualOverhead)} / yr</span>
          </div>
        </Section>

        {/* Company-wide checkups */}
        <Section title="Company-Wide Checkup Summary" icon={Timer} defaultOpen={false}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            Rolled up from every division's own checkup entries. Fill in each division's checkup on its tab — this
            view auto-totals them.
          </p>
          <div className="space-y-4">
            <CheckupPanel
              title="6-Month Checkup (Company)"
              description="Sum of every division's actuals vs. the combined budget."
              checkup={year.companyMidYearCheckup}
              onChange={c => onCompanyCheckupChange('companyMidYearCheckup', c)}
              budgeted={budgetedForCheckup}
              readOnlyActuals
            />
            <CheckupPanel
              title="End-of-Year Checkup (Company)"
              description="Sum of every division's actuals vs. the combined budget."
              checkup={year.companyEndYearCheckup}
              onChange={c => onCompanyCheckupChange('companyEndYearCheckup', c)}
              budgeted={budgetedForCheckup}
              readOnlyActuals
            />
          </div>
        </Section>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="bg-primary text-primary-foreground">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-primary-foreground/70">🎯 Combined Hourly Rate</CardTitle>
            <p className="text-4xl font-extrabold">
              {totals.combinedRequiredHourlyRate > 0 ? $(totals.combinedRequiredHourlyRate, 2) : '—'}
              <span className="text-xl font-normal text-primary-foreground/60"> / hr</span>
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-primary-foreground/60">
              Blended across all divisions at a {pct(totals.blendedMarginPct)} weighted margin target, across {totals.combinedManHours.toLocaleString()} combined man-hours.
            </p>
            {totals.combinedBreakEvenRate > 0 && (
              <p className="text-xs text-primary-foreground/60 mt-1">
                Break-even: {$(totals.combinedBreakEvenRate, 2)}/hr
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ResultCard label="Required Revenue" value={$(totals.combinedRequiredRevenue)} sub="All divisions" />
          <ResultCard label="Net Profit" value={$(totals.combinedNetProfit)} sub="Company-wide" />
          <ResultCard label="Total Costs" value={$(totals.combinedTotalAnnualCosts)} sub="Labor + overhead" />
          <ResultCard label="Employees" value={String(totals.combinedTotalEmployees)} sub="Across all divisions" />
        </div>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" /> Combined Minimum Show-Up Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totals.combinedMinimumShowUpCost > 0 ? $(totals.combinedMinimumShowUpCost, 2) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Blended across divisions using each division's own minimum visit hours and the combined rate.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
