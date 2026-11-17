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
import {
  BudgetInfoButton, CompanyAnnualOverheadInfo, CompanyBreakEvenInfo, CompanyDivisionRateInfo,
  CompanyJobFloorInfo, CompanyMonthlyOverheadInfo, CompanyNetProfitInfo, CompanyOverheadLaborInfo,
  CompanyRequiredRevenueInfo, CompanyTargetRateInfo, CompanyTotalCostsInfo, CompanyWorkersInfo,
} from './BudgetNumbersInfo';

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
    overheadByCategory: totals.overheadByCategory.filter(o => o.key !== 'overheadLabor').map(o => ({
      key: o.key,
      label: o.label,
      annual: o.effective + (o.key === 'miscOverhead' ? totals.overheadLaborAnnual : 0),
    })),
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
                  <span className="font-semibold text-foreground inline-flex items-center gap-1">{$(results.requiredHourlyRate, 2)}/man-hr <BudgetInfoButton id={`company-division-rate-${division.id}`} label={`${division.name} man-hour rate`} title={`${division.name} man-hour rate`}><CompanyDivisionRateInfo /></BudgetInfoButton></span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Overhead rollup with override capability */}
        <Section title="Company overhead (from divisions)" icon={Building2}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            These totals add every division. A monthly line is multiplied by 12. An annual line is used as entered. Custom categories that are not in the standard list are included in Miscellaneous Overhead. Overhead and salaried labor is its own line and is included in the combined annual and monthly totals.
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
              <p className="text-amber-800 inline-flex items-center gap-1">Combined annual overhead <BudgetInfoButton id="company-annual-overhead" label="combined annual overhead" title="Combined annual overhead"><CompanyAnnualOverheadInfo /></BudgetInfoButton></p>
              <p className="font-bold text-amber-900">{$(totals.combinedAnnualOverhead)} / yr</p>
            </div>
            <div className="p-3 rounded-lg border text-sm">
              <p className="text-muted-foreground inline-flex items-center gap-1">Monthly overhead expense <BudgetInfoButton id="company-monthly-overhead" label="monthly overhead expense" title="Monthly overhead expense"><CompanyMonthlyOverheadInfo /></BudgetInfoButton></p>
              <p className="font-bold">{$(totals.monthlyOverheadExpense)} / mo</p>
              <p className="text-[11px] text-muted-foreground">Annual overhead ÷ 12, for cash-flow reference. Rates still use {year.annualWorkingWeeks ?? totals.annualWorkingWeeks} working weeks.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2" data-testid="company-overhead-labor">
            <p className="text-sm font-medium inline-flex items-center gap-1">Overhead & Salaried Labor <BudgetInfoButton id="company-overhead-labor" label="overhead and salaried labor" title="Overhead and salaried labor"><CompanyOverheadLaborInfo /></BudgetInfoButton></p>
            <p className="text-xs text-muted-foreground">
              Read-only rollup. Annualized and monthly amounts are inside combined annual overhead and monthly overhead expense, and are recovered across productive field hours in the company break-even rate and job floor.
            </p>
            {totals.overheadLaborLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No overhead or salaried labor on any division yet.</p>
            ) : totals.overheadLaborLines.map(line => (
              <div key={line.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">{line.name}</span>
                  <span className="block text-xs text-muted-foreground">{line.divisionName} · {line.allocation === 'division' ? 'This division' : line.allocation === 'company_proportional' ? 'Split by billable hours' : 'Company total only'} · {line.payType === 'hourly' ? 'Hourly' : 'Salary'}</span>
                </span>
                <span className="font-medium tabular-nums text-right">{$(line.annualCost)}/yr<br /><span className="text-xs font-normal text-muted-foreground">{$(line.monthlyCost)}/mo</span></span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm" data-testid="company-overhead-labor-total">
              <span className="text-muted-foreground">Total overhead & salaried labor</span>
              <span className="font-semibold">{$(totals.overheadLaborAnnual)} / yr · {$(totals.overheadLaborMonthly)} / mo</span>
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
            baselineNote="Wage is the headcount-weighted average of each division's hourly rate, and payroll burden is weighted by those wages. Monthly overhead adds every division's annualized expenses (monthly × 12, annual as entered, including custom categories and overhead/salaried labor) ÷ 12, plus owner salaries ÷ 12, plus company-wide salaried labor ÷ 12. Monthly crew hours add each division's crews × weekly billable hours × its working weeks, then ÷ 12. Seasonal divisions use weeks worked. Stop times and direct costs are example values."
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
            <CardTitle className="text-sm text-primary-foreground/70 flex items-center gap-1">Combined Man-Hour Rate <BudgetInfoButton id="company-target-rate" label="combined man-hour rate" title="Combined man-hour rate" tone="inverse"><CompanyTargetRateInfo /></BudgetInfoButton></CardTitle>
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
              <p className="text-xs text-primary-foreground/60 mt-1 inline-flex items-center gap-1" data-testid="company-break-even">
                <span>Break-even: {$(totals.combinedBreakEvenRate, 2)}/man-hr
                {totals.overheadLaborAnnual > 0 ? ` · includes ${$(totals.overheadLaborAnnual)} overhead & salaried labor` : ''}</span>
                <BudgetInfoButton id="company-break-even" label="company break-even rate" title="Company break-even rate" tone="inverse"><CompanyBreakEvenInfo /></BudgetInfoButton>
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ResultCard label="Required Revenue" value={$(totals.combinedRequiredRevenue)} sub="All divisions" info={<BudgetInfoButton id="company-required-revenue" label="company required revenue" title="Required revenue"><CompanyRequiredRevenueInfo /></BudgetInfoButton>} />
          <ResultCard label="Net Profit" value={$(totals.combinedNetProfit)} sub="Company-wide" info={<BudgetInfoButton id="company-net-profit" label="company net profit" title="Net profit"><CompanyNetProfitInfo /></BudgetInfoButton>} />
          <ResultCard label="Total Costs" value={$(totals.combinedTotalAnnualCosts)} sub="Labor + overhead" info={<BudgetInfoButton id="company-total-costs" label="company total costs" title="Total costs"><CompanyTotalCostsInfo /></BudgetInfoButton>} />
          <ResultCard label="Productive Workers" value={String(totals.combinedProductiveWorkers)} sub={`${totals.combinedTotalEmployees} field employees`} info={<BudgetInfoButton id="company-workers" label="productive workers" title="Productive workers"><CompanyWorkersInfo /></BudgetInfoButton>} />
        </div>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" /> Company Job Floor Price <BudgetInfoButton id="company-job-floor" label="company job floor price" title="Company job floor price"><CompanyJobFloorInfo /></BudgetInfoButton></CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Calculated company floor</p>
            <p className="text-3xl font-bold" data-testid="company-job-floor">{totals.companyJobFloorCalculated > 0 ? $(totals.companyJobFloorCalculated, 2) : '—'}</p>
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
