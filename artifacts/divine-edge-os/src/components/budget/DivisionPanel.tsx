import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Users, Building2, Target, TrendingUp, Clock, Package, Timer,
} from 'lucide-react';
import {
  DivisionBudget, computeDivision, OVERHEAD_CATEGORIES,
} from '@/lib/budgetCalc';
import { NumField, Section, ResultCard, $, pct } from './shared';
import { CheckupPanel } from './CheckupPanel';

export function DivisionPanel({
  division, onChange, previousResults, previousYear,
}: {
  division: DivisionBudget;
  onChange: (d: DivisionBudget) => void;
  previousResults?: ReturnType<typeof computeDivision> | null;
  previousYear?: number;
}) {
  const set = <K extends keyof DivisionBudget>(key: K, val: DivisionBudget[K]) =>
    onChange({ ...division, [key]: val });

  const results = useMemo(() => computeDivision(division), [division]);

  const budgetedForCheckup = useMemo(() => ({
    revenue: results.requiredRevenue,
    laborCost: results.totalLaborCost,
    materialCost: division.estimatedAnnualMaterialCost,
    overheadByCategory: OVERHEAD_CATEGORIES.map(({ key, label }) => ({
      key, label, annual: (Number(division[key]) || 0) * 12,
    })),
  }), [division, results]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ── Left: Input Sections ── */}
      <div className="lg:col-span-2 space-y-4">

        {/* Capacity */}
        <Section title="Company & Work Capacity" icon={Clock}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
            <NumField label="Number of Crews" value={division.crewCount} onChange={v => set('crewCount', v)} prefix="" hint="Field crews producing revenue" />
            <NumField label="Work Weeks / Year" value={division.workWeeksPerYear} onChange={v => set('workWeeksPerYear', v)} prefix="" hint="e.g., 28–44 weeks for seasonal" />
            <NumField label="Work Days / Week" value={division.workDaysPerWeek} onChange={v => set('workDaysPerWeek', v)} prefix="" hint="Production days only" />
            <NumField label="Hours / Day / Crew" value={division.billableHoursPerDay} onChange={v => set('billableHoursPerDay', v)} prefix="" hint="Total hours at job sites, per worker" />
            <NumField label="Production Efficiency %" value={division.productionEfficiencyPct} onChange={v => set('productionEfficiencyPct', Math.min(100, v))} prefix="%" hint="% of hours that are billable (vs. drive time, setup)" />
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm">
            <span className="font-medium">{results.manHoursYear.toLocaleString()} billable man-hours / year</span>
            <span className="text-muted-foreground"> across {results.totalEmployees} worker{results.totalEmployees !== 1 ? 's' : ''} on {division.crewCount} crew{division.crewCount !== 1 ? 's' : ''}</span>
          </div>
        </Section>

        {/* Labor */}
        <Section title="Labor & Payroll" icon={Users}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
            <NumField label="Owner / Operator Salary" value={division.ownerSalaryAnnual} onChange={v => set('ownerSalaryAnnual', v)} hint="Annual, not included in hourly labor" />
            <NumField label="Employees per Crew" value={division.employeesPerCrew} onChange={v => set('employeesPerCrew', v)} prefix="" hint="Field workers per crew (excl. owner)" />
            <NumField label="Avg. Employee Hourly Rate" value={division.avgEmployeeHourlyRate} onChange={v => set('avgEmployeeHourlyRate', v)} hint="Base wage rate" />
            <NumField label="Avg. Hrs / Week" value={division.avgEmployeeHoursPerWeek} onChange={v => set('avgEmployeeHoursPerWeek', v)} prefix="" hint="Including drive time, meetings" />
            <NumField label="Payroll Burden %" value={division.payrollBurdenPct} onChange={v => set('payrollBurdenPct', v)} prefix="%" hint="Taxes, FICA, WC — typically 18–25%" />
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm space-y-0.5">
            <p><span className="font-medium">{results.totalEmployees}</span> field employees total</p>
            <p>Annual field labor: <span className="font-medium">{$(results.totalLaborCost - division.ownerSalaryAnnual)}</span> (wages + burden)</p>
            <p>Total labor incl. owner: <span className="font-medium">{$(results.totalLaborCost)}</span></p>
          </div>
        </Section>

        {/* Overhead */}
        <Section title="Monthly Overhead" icon={Building2}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">Enter each expense as a monthly amount. The calculator multiplies by 12 for the annual total.</p>
          <div className="grid grid-cols-2 gap-3">
            {OVERHEAD_CATEGORIES.map(({ key, label }) => (
              <NumField
                key={key}
                label={label}
                value={division[key] as number}
                onChange={v => set(key, v)}
              />
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Monthly overhead total</span>
            <span className="font-semibold">{$(results.monthlyOverhead)} / mo</span>
          </div>
          <div className="mt-1 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm flex items-center justify-between">
            <span className="text-amber-800">Annual overhead total</span>
            <span className="font-bold text-amber-900">{$(results.annualOverhead)} / yr</span>
          </div>
        </Section>

        {/* Goals */}
        <Section title="Profit Goals & Materials" icon={Target}>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <NumField label="Target Net Margin %" value={division.targetNetMarginPct} onChange={v => set('targetNetMarginPct', Math.min(99, v))} prefix="%" hint="Net profit as % of revenue (10–35% is typical)" />
            <NumField label="Minimum Visit Hours" value={division.minimumVisitHours} onChange={v => set('minimumVisitHours', v)} prefix="" hint="Min. hours billed per stop (drive + setup + minimum job time)" />
            <NumField label="Estimated Total Material Sold" value={division.estimatedAnnualMaterialCost} onChange={v => set('estimatedAnnualMaterialCost', v)} hint="Annual $ of materials sold at cost (before markup)" />
          </div>
        </Section>

        {/* P4P Analysis */}
        <Section title="Employee Pay for Performance (P4P)" icon={TrendingUp} defaultOpen={false}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            The employee earns whichever is greater: their guaranteed base rate, or their P4P
            percentage of revenue-per-hour — never both added together.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <NumField label="Employee Base Rate ($/hr)" value={division.employeeBaseHourlyRate} onChange={v => set('employeeBaseHourlyRate', v)} hint="Minimum guaranteed hourly pay" />
            <NumField label="P4P Percentage (%)" value={division.p4pPercentage} onChange={v => set('p4pPercentage', Math.min(100, v))} prefix="%" hint="% of revenue-per-hour the employee earns instead of base (25–45% is typical)" />
          </div>
          {results.requiredHourlyRate > 0 && (
            <div className="mt-4 rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold">At your target rate of {$(results.requiredHourlyRate, 2)}/hr:</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guaranteed base (with burden)</span>
                  <span>{$(division.employeeBaseHourlyRate * (1 + division.payrollBurdenPct / 100), 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P4P: {division.p4pPercentage}% of revenue/hr</span>
                  <span className={results.isP4PActive ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}>
                    {$(results.requiredHourlyRate * division.p4pPercentage / 100, 2)}/hr {results.isP4PActive ? '(active — pays more)' : '(below base — base pays)'}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Employee earns</span>
                  <span className="text-emerald-700">{$(results.employeeTotalPayPerHour, 2)}/hr effective</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Company labor cost/hr (pay + burden)</span>
                  <span>{$(results.companyLaborCostPerHour, 2)}</span>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* Checkups */}
        <Section title="Mid-Year & End-of-Year Checkup" icon={Timer} defaultOpen={false}>
          <p className="text-xs text-muted-foreground pt-1 pb-3">
            Enter actual results partway through the year and compare against what this division budgeted.
          </p>
          <div className="space-y-4">
            <CheckupPanel
              title="6-Month Checkup"
              description="Actuals for the first half of the year vs. this division's full-year budget."
              checkup={division.midYearCheckup}
              onChange={c => set('midYearCheckup', { ...c, completedAt: new Date().toISOString() })}
              budgeted={budgetedForCheckup}
            />
            <CheckupPanel
              title="End-of-Year Checkup"
              description="Final actuals for the year vs. budget."
              checkup={division.endYearCheckup}
              onChange={c => set('endYearCheckup', { ...c, completedAt: new Date().toISOString() })}
              budgeted={budgetedForCheckup}
            />
          </div>
        </Section>
      </div>

      {/* ── Right: Results Panel ── */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="bg-primary text-primary-foreground">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-primary-foreground/70">🎯 Target Hourly Rate — {division.name}</CardTitle>
            <p className="text-4xl font-extrabold">
              {results.requiredHourlyRate > 0 ? $(results.requiredHourlyRate, 2) : '—'}
              <span className="text-xl font-normal text-primary-foreground/60"> / hr</span>
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-primary-foreground/60">
              Rate needed to hit {division.targetNetMarginPct}% net margin across {results.manHoursYear.toLocaleString()} billable man-hours.
            </p>
            {results.breakEvenRate > 0 && (
              <p className="text-xs text-primary-foreground/60 mt-1">
                Break-even: {$(results.breakEvenRate, 2)}/hr
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ResultCard label="Required Revenue" value={$(results.requiredRevenue)} sub="Annual gross" />
          <ResultCard label="Net Profit" value={$(results.netProfit)} sub={`${pct(division.targetNetMarginPct)} margin`} />
          <ResultCard label="Total Costs" value={$(results.totalAnnualCosts)} sub="Labor + overhead" />
          <ResultCard label="Man-Hours" value={results.manHoursYear.toLocaleString()} sub="Per year" />
        </div>

        {/* Minimum show-up cost */}
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" /> Minimum Show-Up Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{results.minimumShowUpCost > 0 ? $(results.minimumShowUpCost, 2) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              What to charge just to send a crew out — {division.minimumVisitHours} minimum billed hour{division.minimumVisitHours !== 1 ? 's' : ''} × {$(results.requiredHourlyRate, 2)}/hr target rate. Never quote below this, even for the smallest job.
            </p>
          </CardContent>
        </Card>

        {/* Cost breakdown */}
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Field Labor', val: results.totalLaborCost - division.ownerSalaryAnnual },
              { label: 'Owner Salary', val: division.ownerSalaryAnnual },
              { label: 'Annual Overhead', val: results.annualOverhead },
            ].map(({ label, val }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 rounded bg-muted overflow-hidden w-16">
                    <div
                      className="h-full rounded bg-primary/60"
                      style={{ width: `${Math.min(100, results.totalAnnualCosts > 0 ? val / results.totalAnnualCosts * 100 : 0)}%` }}
                    />
                  </div>
                  <span className="font-medium w-24 text-right">{$(val)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Material Markup */}
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Recommended Material Markup</CardTitle>
          </CardHeader>
          <CardContent>
            {division.estimatedAnnualMaterialCost > 0 ? (
              <>
                <p className="text-3xl font-bold">{results.recommendedMarkup}%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Covers this division's share of overhead attributable to materials ({$(results.overheadAllocatedToMaterials)} of {$(results.annualOverhead)} total) plus your {division.targetNetMarginPct}% margin target — not the full overhead burden, since labor billing already covers most of it.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Enter "Estimated Total Material Sold" above to calculate a markup recommendation.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Year over Year */}
        {previousResults && previousYear && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Year-over-Year vs. {previousYear}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Required Rate', curr: results.requiredHourlyRate, prev: previousResults.requiredHourlyRate, fmt: (v: number) => `${$(v, 2)}/hr` },
                { label: 'Total Costs', curr: results.totalAnnualCosts, prev: previousResults.totalAnnualCosts, fmt: $ },
                { label: 'Net Profit', curr: results.netProfit, prev: previousResults.netProfit, fmt: $ },
              ].map(({ label, curr, prev, fmt }) => {
                const diff = curr - prev;
                const pctDiff = prev > 0 ? diff / prev * 100 : 0;
                return (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{fmt(curr)}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${diff > 0 ? 'text-red-600 border-red-200' : diff < 0 ? 'text-emerald-600 border-emerald-200' : ''}`}
                      >
                        {diff > 0 ? '+' : ''}{pct(pctDiff)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
