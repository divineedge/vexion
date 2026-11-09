import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Building2, Package, Timer, Layers, Calculator } from 'lucide-react';
import type { JobPricingFloorInputs } from '@/lib/jobPricingFloor';
import { companyFloorBaseline } from '@/lib/jobPricingFloorBaseline';
import { ScopedJobPricingFloor } from './ScopedJobPricingFloor';
import {
  BudgetYear, computeCompanyTotal,
} from '@/lib/budgetCalc';
import { NumField, Section, ResultCard, $, pct } from './shared';
import { CheckupPanel } from './CheckupPanel';

export function CompanyTotalPanel({
  year, onCompanyFloorChange, onCompanyCheckupChange, onJobPricingFloorChange,
}: {
  onJobPricingFloorChange: (next: JobPricingFloorInputs | undefined) => void;
  year: BudgetYear;
  onCompanyFloorChange: (override: number | null) => void;
  onCompanyCheckupChange: (which: 'companyMidYearCheckup' | 'companyEndYearCheckup', c: BudgetYear['companyMidYearCheckup']) => void;
}) {
  const totals = useMemo(() => computeCompanyTotal(year), [year]);

  const jpfBaseline = useMemo(() => companyFloorBaseline(year), [year]);

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
            <CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground" /> Man-Hour Rate by Division</CardTitle>
            <CardDescription className="text-xs">Each division's required rate per productive man-hour vs. the blended company-wide rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {totals.rows.map(({ division, results }) => (
              <div key={division.id} className="flex items-center justify-between text-sm py-1">
                <span>{division.name}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{results.manHoursYear.toLocaleString()} man-hrs</span>
                  <span className="font-semibold text-foreground">{$(results.requiredHourlyRate, 2)}/man-hr</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Overhead rollup with override capability */}
        <Section title="Company overhead (from divisions)" icon={Building2}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            These totals add every division. Custom categories that are not in the standard list are included in Miscellaneous Overhead.
          </p>
          <div className="space-y-2">
            {totals.overheadByCategory.map(o => (
              <div key={o.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{o.label}</span>
                <span className="font-medium tabular-nums">{$(o.effective)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
              <p className="text-amber-800">Combined annual overhead</p>
              <p className="font-bold text-amber-900">{$(totals.combinedAnnualOverhead)} / yr</p>
            </div>
            <div className="p-3 rounded-lg border text-sm">
              <p className="text-muted-foreground">Monthly overhead expense</p>
              <p className="font-bold">{$(totals.monthlyOverheadExpense)} / mo</p>
              <p className="text-[11px] text-muted-foreground">Annual overhead ÷ 12, for cash-flow reference. Rates still use {year.annualWorkingWeeks ?? totals.annualWorkingWeeks} working weeks.</p>
            </div>
          </div>
        </Section>

        {/* Company-wide job pricing floor */}
        <Section title="Job Pricing Floor — Company-wide" icon={Calculator} defaultOpen={false}>
          <ScopedJobPricingFloor
            scopeId="company"
            scopeLabel="the company"
            saved={year.companyJobPricingFloor}
            baseline={jpfBaseline}
            onChange={onJobPricingFloorChange}
            baselineNote="The company floor adds each division's labor, materials, and overhead, then divides by combined billable hours. The stop calculator shows that burden on a monthly basis. Stop times and direct costs are example values."
          />
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
            <CardTitle className="text-sm text-primary-foreground/70">Combined Man-Hour Rate</CardTitle>
            <p className="text-4xl font-extrabold">
              {totals.combinedRequiredHourlyRate > 0 ? $(totals.combinedRequiredHourlyRate, 2) : '—'}
              <span className="text-xl font-normal text-primary-foreground/60"> / man-hr</span>
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-primary-foreground/60">
              Blended across all divisions at a {pct(totals.blendedMarginPct)} weighted margin target, across {totals.combinedManHours.toLocaleString()} combined man-hours.
            </p>
            {totals.combinedBreakEvenRate > 0 && (
              <p className="text-xs text-primary-foreground/60 mt-1">
                Break-even: {$(totals.combinedBreakEvenRate, 2)}/man-hr
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ResultCard label="Required Revenue" value={$(totals.combinedRequiredRevenue)} sub="All divisions" />
          <ResultCard label="Net Profit" value={$(totals.combinedNetProfit)} sub="Company-wide" />
          <ResultCard label="Total Costs" value={$(totals.combinedTotalAnnualCosts)} sub="Labor + overhead" />
          <ResultCard label="Productive Workers" value={String(totals.combinedProductiveWorkers)} sub={`${totals.combinedTotalEmployees} field employees`} />
        </div>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" /> Company Job Floor Price</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Calculated company floor</p>
            <p className="text-3xl font-bold">{totals.companyJobFloorCalculated > 0 ? $(totals.companyJobFloorCalculated, 2) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Live sum of division labor, materials, and overhead per billable hour, times the average minimum visit.
            </p>
            <div className="mt-3">
              <NumField label="Company floor override" value={year.companyFloorPriceOverride ?? 0} onChange={v => onCompanyFloorChange(v > 0 ? v : null)} hint={year.companyFloorPriceOverride != null ? `Using ${$(totals.companyJobFloorPrice, 2)}.` : 'Leave at zero to follow the division math.'} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
