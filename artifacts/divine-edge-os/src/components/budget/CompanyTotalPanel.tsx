import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Building2, Package, Timer, Layers, Calculator } from 'lucide-react';
import type { JobPricingFloorInputs } from '@/lib/jobPricingFloor';
import { companyFloorBaseline } from '@/lib/jobPricingFloorBaseline';
import { ScopedJobPricingFloor } from './ScopedJobPricingFloor';
import {
  BudgetYear, OVERHEAD_CATEGORIES, computeCompanyTotal, expenseFrequency, salaryPayrollAnnual,
  type ExpenseFrequency, type OverheadLineItems,
} from '@/lib/budgetCalc';
import { NumField, Section, ResultCard, $, pct, ExpenseLineEditor, PriorYearPrice } from './shared';
import { CheckupPanel } from './CheckupPanel';
import {
  BudgetInfoButton, CompanyAnnualOverheadInfo, CompanyBreakEvenInfo, CompanyDivisionRateInfo,
  CompanyJobFloorInfo, CompanyMonthlyOverheadInfo, CompanyNetProfitInfo, CompanyOverheadLaborInfo,
  CompanyRequiredRevenueInfo, CompanyTargetRateInfo, CompanyTotalCostsInfo, CompanyWorkersInfo,
} from './BudgetNumbersInfo';

export function CompanyTotalPanel({
  year, previousYear, onCompanyFloorChange, onCompanyCheckupChange, onJobPricingFloorChange,
  onCompanyTotalRevenueChange, onCompanyOverheadChange, onCompanyOverheadFrequencyChange, onDivisionIncomeChange,
  onCompanyCogsChange, onCompanyCogsFrequencyChange, onCompanySalaryChange, onCompanySalaryFrequencyChange,
}: {
  onJobPricingFloorChange: (next: JobPricingFloorInputs | undefined) => void;
  year: BudgetYear;
  previousYear?: BudgetYear | null;
  onCompanyFloorChange: (override: number | null) => void;
  onCompanyCheckupChange: (which: 'companyMidYearCheckup' | 'companyEndYearCheckup', c: BudgetYear['companyMidYearCheckup']) => void;
  onCompanyTotalRevenueChange: (revenue: number) => void;
  onCompanyOverheadChange: (key: keyof OverheadLineItems, amount: number) => void;
  onCompanyOverheadFrequencyChange: (key: keyof OverheadLineItems, frequency: ExpenseFrequency) => void;
  onDivisionIncomeChange: (divisionId: string, income: number) => void;
  onCompanyCogsChange: (amount: number) => void;
  onCompanyCogsFrequencyChange: (frequency: ExpenseFrequency) => void;
  onCompanySalaryChange: (amount: number) => void;
  onCompanySalaryFrequencyChange: (frequency: ExpenseFrequency) => void;
}) {
  const totals = useMemo(() => computeCompanyTotal(year), [year]);
  const previousTotals = useMemo(() => previousYear ? computeCompanyTotal(previousYear) : null, [previousYear]);

  const jpfBaseline = useMemo(() => companyFloorBaseline(year), [year]);

  const budgetedForCheckup = useMemo(() => ({
    revenue: totals.combinedRequiredRevenue,
    laborCost: totals.combinedLaborCost,
    materialCost: totals.combinedMaterialCost,
    overheadByCategory: totals.overheadByCategory.filter(o => o.key !== 'overheadLabor').map(o => ({
      key: o.key,
      label: o.label,
      annual: o.effective + (o.key === 'miscOverhead' ? totals.salaryPayrollAnnual : 0),
    })),
  }), [totals]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <Section title="Checkup review" icon={Timer}>
          <div data-testid="checkup-review" className="space-y-4 pt-2">
            <div className="max-w-xs">
              <NumField
                label="Company total revenue"
                testId="input-company-total-revenue"
                value={year.companyTotalRevenue ?? 0}
                onChange={value => onCompanyTotalRevenueChange(Math.max(0, value))}
                hint="Annual revenue for the whole company."
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">Overhead expenses</p>
              <p className="text-xs text-muted-foreground">Entered for the company, by category. Each division shows its income share of the annual amount.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {OVERHEAD_CATEGORIES.map(({ key, label }) => (
                  <ExpenseLineEditor
                    key={key}
                    label={label}
                    amount={Number(year.companyOverhead?.[key]) || 0}
                    frequency={expenseFrequency(year.companyOverheadFrequency?.[key])}
                    amountTestId={`input-company-overhead-${key}`}
                    testId={`company-overhead-frequency-${key}`}
                    onAmount={value => onCompanyOverheadChange(key, Math.max(0, value))}
                    onFrequency={frequency => onCompanyOverheadFrequencyChange(key, frequency)}
                  />
                ))}
                <ExpenseLineEditor
                  label="COGS / Supplies"
                  amount={year.companyCogs ?? 0}
                  frequency={expenseFrequency(year.companyCogsFrequency)}
                  amountTestId="input-company-cogs"
                  testId="company-cogs-frequency"
                  onAmount={value => onCompanyCogsChange(Math.max(0, value))}
                  onFrequency={onCompanyCogsFrequencyChange}
                  note="Company-level materials and supplies. Division COGS is added once in the total below and is not typed again here. Included in the company job floor, not in overhead or break-even."
                />
                <ExpenseLineEditor
                  label="Salary / Payroll"
                  amount={year.companySalaryPayroll ?? 0}
                  frequency={expenseFrequency(year.companySalaryPayrollFrequency)}
                  amountTestId="input-company-salary-payroll"
                  testId="company-salary-frequency"
                  onAmount={value => onCompanySalaryChange(Math.max(0, value))}
                  onFrequency={onCompanySalaryFrequencyChange}
                  note="Company-level salary and payroll. Division salary lines and salaried roles are added once in the total below. Included once in company overhead, break-even, and the job floor."
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">Division income</p>
              <p className="text-xs text-muted-foreground">Total income for each division. Company overhead is split by division income ÷ total division income.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {year.divisions.map(division => (
                  <NumField
                    key={division.id}
                    label={`${division.name} total income`}
                    testId={`input-division-income-${division.name}`}
                    value={division.income ?? 0}
                    onChange={value => onDivisionIncomeChange(division.id, Math.max(0, value))}
                    hint="Also shown as this division's revenue."
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>

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
            These totals add every division. A monthly line is multiplied by 12. An annual line is used as entered. Custom categories that are not in the standard list are included in Miscellaneous Overhead. Salary / payroll is its own line and is included once in the combined annual and monthly totals. COGS / supplies is shown with it and is included in the job floor, not in overhead.
          </p>
          <div className="space-y-2">
            {totals.overheadByCategory.map(o => (
              <div key={o.key} className="flex items-center justify-between gap-3 text-sm" data-testid={o.key === 'overheadLabor' ? 'company-salary-total' : undefined}>
                <span className="text-muted-foreground">{o.label}</span>
                <span className="font-medium tabular-nums">{$(o.effective)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 text-sm" data-testid="company-cogs-total">
              <span className="text-muted-foreground">COGS / Supplies</span>
              <span className="font-medium tabular-nums">{$(totals.combinedMaterialCost)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm font-semibold" data-testid="company-total-with-cogs">
              <span>Total including COGS</span>
              <span className="tabular-nums">{$(totals.combinedTotalAnnualCosts + totals.combinedMaterialCost)}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
              <p className="text-amber-800 inline-flex items-center gap-1">Combined annual overhead <BudgetInfoButton id="company-annual-overhead" label="combined annual overhead" title="Combined annual overhead"><CompanyAnnualOverheadInfo /></BudgetInfoButton></p>
              <p className="font-bold text-amber-900">{$(totals.combinedAnnualOverhead)} / yr</p>
            </div>
            <div className="p-3 rounded-lg border text-sm">
              <p className="text-muted-foreground inline-flex items-center gap-1">Monthly overhead expense <BudgetInfoButton id="company-monthly-overhead" label="monthly overhead expense" title="Monthly overhead expense"><CompanyMonthlyOverheadInfo /></BudgetInfoButton></p>
              <p className="font-bold">{$(totals.monthlyOverheadExpense)} / mo</p>
              <p className="text-[11px] text-muted-foreground">Annual overhead ÷ 12, for cash-flow reference. Each division’s rates use that division’s working weeks.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2" data-testid="company-overhead-labor">
            <p className="text-sm font-medium inline-flex items-center gap-1">Salary / Payroll <BudgetInfoButton id="company-overhead-labor" label="salary and payroll" title="Salary / payroll"><CompanyOverheadLaborInfo /></BudgetInfoButton></p>
            <p className="text-xs text-muted-foreground">
              Itemized breakdown of the Salary / Payroll line above. Division salary lines, company salary, and salaried roles are each included once in combined overhead, the break-even rate, and the job floor.
            </p>
            {year.divisions.map(division => {
              const annual = salaryPayrollAnnual(division);
              if (!(annual > 0)) return null;
              return (
                <div key={`salary-${division.id}`} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">Salary / Payroll</span>
                    <span className="block text-xs text-muted-foreground">{division.name} · Expense line</span>
                  </span>
                  <span className="font-medium tabular-nums text-right">{$(annual)}/yr<br /><span className="text-xs font-normal text-muted-foreground">{$(annual / 12)}/mo</span></span>
                </div>
              );
            })}
            {totals.companySalaryExpense > 0 && (
              <div className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">Salary / Payroll</span>
                  <span className="block text-xs text-muted-foreground">Company total · Expense line</span>
                </span>
                <span className="font-medium tabular-nums text-right">{$(totals.companySalaryExpense)}/yr<br /><span className="text-xs font-normal text-muted-foreground">{$(totals.companySalaryExpense / 12)}/mo</span></span>
              </div>
            )}
            {totals.overheadLaborLines.length === 0 && totals.salaryPayrollAnnual === 0 ? (
              <p className="text-sm text-muted-foreground">No salary or payroll on any division yet.</p>
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
              <span className="text-muted-foreground">Total salary / payroll</span>
              <span className="font-semibold">{$(totals.salaryPayrollAnnual)} / yr · {$(totals.salaryPayrollMonthly)} / mo</span>
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
            baselineNote="Wage is the headcount-weighted average of each division's hourly rate, and payroll burden is weighted by those wages. Monthly overhead adds every division's annualized expenses (monthly × 12, annual as entered, including custom categories and overhead/salaried labor) ÷ 12, plus owner salaries ÷ 12, plus company-wide salaried labor ÷ 12. Monthly crew hours add each division's crews × weekly billable hours × its own working weeks, then ÷ 12. Stop times and direct costs are example values."
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
                {totals.salaryPayrollAnnual > 0 ? ` · includes ${$(totals.salaryPayrollAnnual)} salary / payroll` : ''}</span>
                <BudgetInfoButton id="company-break-even" label="company break-even rate" title="Company break-even rate" tone="inverse"><CompanyBreakEvenInfo /></BudgetInfoButton>
              </p>
            )}
            {previousYear && previousTotals && (
              <PriorYearPrice inverse year={previousYear.year} testId="prior-year-company-rate" text={`${$(previousTotals.combinedRequiredHourlyRate, 2)}/man-hr · break-even ${$(previousTotals.combinedBreakEvenRate, 2)}/man-hr`} />
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
            {previousYear && previousTotals && (
              <PriorYearPrice year={previousYear.year} testId="prior-year-company-job-floor" text={$(previousTotals.companyJobFloorCalculated, 2)} />
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Live sum of division labor, materials, and overhead per billable hour, times the average minimum visit.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              COGS / Supplies {$(totals.combinedMaterialCost)} included in this floor
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
