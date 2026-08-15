import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  DollarSign, Users, Building2, Target, TrendingUp, Save, RefreshCw,
  Calculator, ChevronDown, ChevronRight, Info, ShieldAlert, Clock,
  Loader2, ArrowUp, ArrowDown, Minus, CheckCircle2,
} from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface BudgetData {
  year: number;
  // Company Capacity
  crewCount: number;
  workWeeksPerYear: number;
  workDaysPerWeek: number;
  billableHoursPerDay: number;
  productionEfficiencyPct: number;
  // Owner / Management
  ownerSalaryAnnual: number;
  // Employees
  employeesPerCrew: number;
  avgEmployeeHourlyRate: number;
  avgEmployeeHoursPerWeek: number;
  payrollBurdenPct: number;
  // Monthly Overhead
  vehiclePayments: number;
  fuelMaintenance: number;
  generalLiabilityInsurance: number;
  vehicleInsurance: number;
  workersComp: number;
  equipmentPayments: number;
  equipmentRepair: number;
  officeRent: number;
  marketingAdvertising: number;
  softwareSubscriptions: number;
  phoneCommunication: number;
  uniformsPPE: number;
  accountingLegal: number;
  miscOverhead: number;
  // Goals
  targetNetMarginPct: number;
  // P4P
  employeeBaseHourlyRate: number;
  p4pPercentage: number;
  // Saved meta
  savedAt?: string;
}

function defaultBudget(): BudgetData {
  return {
    year: new Date().getFullYear(),
    crewCount: 2,
    workWeeksPerYear: 32,
    workDaysPerWeek: 5,
    billableHoursPerDay: 8,
    productionEfficiencyPct: 80,
    ownerSalaryAnnual: 65000,
    employeesPerCrew: 2,
    avgEmployeeHourlyRate: 18,
    avgEmployeeHoursPerWeek: 40,
    payrollBurdenPct: 22,
    vehiclePayments: 1200,
    fuelMaintenance: 600,
    generalLiabilityInsurance: 350,
    vehicleInsurance: 400,
    workersComp: 250,
    equipmentPayments: 500,
    equipmentRepair: 200,
    officeRent: 0,
    marketingAdvertising: 500,
    softwareSubscriptions: 150,
    phoneCommunication: 100,
    uniformsPPE: 80,
    accountingLegal: 200,
    miscOverhead: 150,
    targetNetMarginPct: 30,
    employeeBaseHourlyRate: 18,
    p4pPercentage: 35,
  };
}

// ── Computed ──────────────────────────────────────────────────────────────────
function compute(b: BudgetData) {
  const billableHoursYear =
    b.crewCount * b.workWeeksPerYear * b.workDaysPerWeek * b.billableHoursPerDay *
    (b.productionEfficiencyPct / 100);

  const totalEmployees = b.crewCount * b.employeesPerCrew;
  const employeeAnnualWages =
    totalEmployees * b.avgEmployeeHourlyRate * b.avgEmployeeHoursPerWeek * b.workWeeksPerYear;
  const employeeLaborCost = employeeAnnualWages * (1 + b.payrollBurdenPct / 100);
  const totalLaborCost = employeeLaborCost + b.ownerSalaryAnnual;

  const monthlyOverhead =
    b.vehiclePayments + b.fuelMaintenance + b.generalLiabilityInsurance + b.vehicleInsurance +
    b.workersComp + b.equipmentPayments + b.equipmentRepair + b.officeRent +
    b.marketingAdvertising + b.softwareSubscriptions + b.phoneCommunication +
    b.uniformsPPE + b.accountingLegal + b.miscOverhead;
  const annualOverhead = monthlyOverhead * 12;
  const totalAnnualCosts = totalLaborCost + annualOverhead;

  const requiredRevenue = b.targetNetMarginPct >= 100 ? 0 :
    totalAnnualCosts / (1 - b.targetNetMarginPct / 100);
  const requiredHourlyRate = billableHoursYear > 0 ? requiredRevenue / billableHoursYear : 0;
  const breakEvenRate = billableHoursYear > 0 ? totalAnnualCosts / billableHoursYear : 0;
  const netProfit = requiredRevenue - totalAnnualCosts;

  // P4P at target rate
  const baseRateWithBurden = b.employeeBaseHourlyRate * (1 + b.payrollBurdenPct / 100);
  const excessPerHour = Math.max(0, requiredHourlyRate - baseRateWithBurden);
  const p4pBonusPerHour = excessPerHour * (b.p4pPercentage / 100);
  const employeeTotalPayPerHour = b.employeeBaseHourlyRate + p4pBonusPerHour;
  const companyLaborCostPerHour = baseRateWithBurden + p4pBonusPerHour;

  // Recommended material markup: needs to cover overhead allocation + profit margin
  const overheadPctOfRevenue = requiredRevenue > 0 ? annualOverhead / requiredRevenue : 0;
  const recommendedMarkup = Math.round((overheadPctOfRevenue + b.targetNetMarginPct / 100) * 100 / 
    (1 - overheadPctOfRevenue - b.targetNetMarginPct / 100));

  return {
    billableHoursYear: Math.round(billableHoursYear),
    totalEmployees,
    totalLaborCost,
    annualOverhead,
    monthlyOverhead,
    totalAnnualCosts,
    requiredRevenue,
    requiredHourlyRate,
    breakEvenRate,
    netProfit,
    employeeTotalPayPerHour,
    companyLaborCostPerHour,
    recommendedMarkup: Math.max(0, recommendedMarkup),
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────
const $ = (n: number, d = 0) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

function NumField({
  label, value, onChange, prefix = '$', hint, min = 0,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; hint?: string; min?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          min={min}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className={prefix ? 'pl-7' : ''}
        />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        className="w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-muted-foreground" /> {title}
            </span>
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 px-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function ResultCard({ label, value, sub, highlight, trend }: {
  label: string; value: string; sub?: string; highlight?: boolean; trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
      <p className={`text-xs font-medium mb-1 ${highlight ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p>
      <div className="flex items-end gap-1">
        <p className={`text-2xl font-bold leading-none ${highlight ? 'text-primary-foreground' : ''}`}>{value}</p>
        {trend === 'up' && <ArrowUp className="w-3.5 h-3.5 text-emerald-500 mb-0.5" />}
        {trend === 'down' && <ArrowDown className="w-3.5 h-3.5 text-red-500 mb-0.5" />}
        {trend === 'neutral' && <Minus className="w-3.5 h-3.5 text-muted-foreground mb-0.5" />}
      </div>
      {sub && <p className={`text-xs mt-1 ${highlight ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{sub}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BudgetPage() {
  const { canManageOffice } = useAuth();
  const [budget, setBudget] = useState<BudgetData>(defaultBudget);
  const [previousBudget, setPreviousBudget] = useState<BudgetData | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load saved budget on mount
  useEffect(() => {
    customFetch<{ budgetData: BudgetData | null }>('/api/settings/budget')
      .then((data: { budgetData: BudgetData | null } | null) => {
        if (data?.budgetData) {
          const saved = data.budgetData as any;
          // Check if it's an array (multiple years) or single object
          if (Array.isArray(saved)) {
            const sorted = [...saved].sort((a, b) => b.year - a.year);
            if (sorted[0]) setBudget({ ...defaultBudget(), ...sorted[0] });
            if (sorted[1]) setPreviousBudget(sorted[1]);
          } else {
            setBudget({ ...defaultBudget(), ...saved });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = useCallback(<K extends keyof BudgetData>(key: K, val: BudgetData[K]) =>
    setBudget(b => ({ ...b, [key]: val })), []);

  const results = useMemo(() => compute(budget), [budget]);
  const prevResults = useMemo(() => previousBudget ? compute(previousBudget) : null, [previousBudget]);

  const handleSave = async () => {
    setSaving(true);
    const toSave = { ...budget, savedAt: new Date().toISOString() };
    try {
      await customFetch('/api/settings/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetData: toSave }),
      });
      setBudget(toSave);
      toast.success('Budget saved');
    } catch {
      toast.error('Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  if (!canManageOffice) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <ShieldAlert className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Budget is restricted</h2>
        <p className="text-muted-foreground max-w-sm">Only owners and managers can access the budget calculator.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const overheadCategories: { key: keyof BudgetData; label: string }[] = [
    { key: 'vehiclePayments', label: 'Vehicle Payments / Leases' },
    { key: 'fuelMaintenance', label: 'Fuel & Vehicle Maintenance' },
    { key: 'generalLiabilityInsurance', label: 'General Liability Insurance' },
    { key: 'vehicleInsurance', label: 'Commercial Auto Insurance' },
    { key: 'workersComp', label: "Workers' Comp Insurance" },
    { key: 'equipmentPayments', label: 'Equipment Payments' },
    { key: 'equipmentRepair', label: 'Equipment Repair/Maintenance' },
    { key: 'officeRent', label: 'Office / Rent' },
    { key: 'marketingAdvertising', label: 'Marketing & Advertising' },
    { key: 'softwareSubscriptions', label: 'Software & Subscriptions' },
    { key: 'phoneCommunication', label: 'Phone & Communication' },
    { key: 'uniformsPPE', label: 'Uniforms & Safety PPE' },
    { key: 'accountingLegal', label: 'Accounting, Legal & Professional' },
    { key: 'miscOverhead', label: 'Miscellaneous Overhead' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Budget Calculator</h1>
          <p className="text-muted-foreground mt-1">
            Enter your costs and goals to find out what hourly rate you need to hit your target profit margin.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Year</span>
            <input
              type="number"
              className="w-16 text-sm font-medium border-0 p-0 bg-transparent focus:outline-none"
              value={budget.year}
              onChange={e => set('year', parseInt(e.target.value) || new Date().getFullYear())}
            />
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Budget
          </Button>
        </div>
      </div>

      {budget.savedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Last saved {new Date(budget.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Input Sections ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Capacity */}
          <Section title="Company & Work Capacity" icon={Clock}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
              <NumField label="Number of Crews" value={budget.crewCount} onChange={v => set('crewCount', v)} prefix="" hint="Field crews producing revenue" />
              <NumField label="Work Weeks / Year" value={budget.workWeeksPerYear} onChange={v => set('workWeeksPerYear', v)} prefix="" hint="e.g., 28–44 weeks for seasonal" />
              <NumField label="Work Days / Week" value={budget.workDaysPerWeek} onChange={v => set('workDaysPerWeek', v)} prefix="" hint="Production days only" />
              <NumField label="Hours / Day / Crew" value={budget.billableHoursPerDay} onChange={v => set('billableHoursPerDay', v)} prefix="" hint="Total hours at job sites" />
              <NumField label="Production Efficiency %" value={budget.productionEfficiencyPct} onChange={v => set('productionEfficiencyPct', Math.min(100, v))} prefix="%" hint="% of hours that are billable (vs. drive time, setup)" />
            </div>
            <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm">
              <span className="font-medium">{results.billableHoursYear.toLocaleString()} billable hours / year</span>
              <span className="text-muted-foreground"> across {budget.crewCount} crew{budget.crewCount !== 1 ? 's' : ''}</span>
            </div>
          </Section>

          {/* Labor */}
          <Section title="Labor & Payroll" icon={Users}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
              <NumField label="Owner / Operator Salary" value={budget.ownerSalaryAnnual} onChange={v => set('ownerSalaryAnnual', v)} hint="Annual, not included in hourly labor" />
              <NumField label="Employees per Crew" value={budget.employeesPerCrew} onChange={v => set('employeesPerCrew', v)} prefix="" hint="Field workers per crew (excl. owner)" />
              <NumField label="Avg. Employee Hourly Rate" value={budget.avgEmployeeHourlyRate} onChange={v => set('avgEmployeeHourlyRate', v)} hint="Base wage rate" />
              <NumField label="Avg. Hrs / Week" value={budget.avgEmployeeHoursPerWeek} onChange={v => set('avgEmployeeHoursPerWeek', v)} prefix="" hint="Including drive time, meetings" />
              <NumField label="Payroll Burden %" value={budget.payrollBurdenPct} onChange={v => set('payrollBurdenPct', v)} prefix="%" hint="Taxes, FICA, WC — typically 18–25%" />
            </div>
            <div className="mt-4 p-3 rounded-lg bg-muted/40 text-sm space-y-0.5">
              <p><span className="font-medium">{results.totalEmployees}</span> field employees total</p>
              <p>Annual field labor: <span className="font-medium">{$(results.totalLaborCost - budget.ownerSalaryAnnual)}</span> (wages + burden)</p>
              <p>Total labor incl. owner: <span className="font-medium">{$(results.totalLaborCost)}</span></p>
            </div>
          </Section>

          {/* Overhead */}
          <Section title="Monthly Overhead" icon={Building2}>
            <p className="text-xs text-muted-foreground pt-1 pb-3">Enter each expense as a monthly amount. The calculator multiplies by 12 for the annual total.</p>
            <div className="grid grid-cols-2 gap-3">
              {overheadCategories.map(({ key, label }) => (
                <NumField
                  key={key}
                  label={label}
                  value={budget[key] as number}
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
          <Section title="Profit Goals" icon={Target}>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <NumField label="Target Net Margin %" value={budget.targetNetMarginPct} onChange={v => set('targetNetMarginPct', Math.min(99, v))} prefix="%" hint="Net profit as % of revenue (10–35% is typical)" />
            </div>
          </Section>

          {/* P4P Analysis */}
          <Section title="Employee Pay for Performance (P4P)" icon={TrendingUp} defaultOpen={false}>
            <p className="text-xs text-muted-foreground pt-1 pb-3">
              P4P pays employees a percentage of the revenue they generate above their base labor cost. 
              This shows how much each employee earns at your target production rate.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <NumField label="Employee Base Rate ($/hr)" value={budget.employeeBaseHourlyRate} onChange={v => set('employeeBaseHourlyRate', v)} hint="Minimum guaranteed hourly pay" />
              <NumField label="P4P Percentage (%)" value={budget.p4pPercentage} onChange={v => set('p4pPercentage', Math.min(100, v))} prefix="%" hint="% of revenue above base cost the employee earns (25–45% is typical)" />
            </div>
            {results.requiredHourlyRate > 0 && (
              <div className="mt-4 rounded-lg border p-4 space-y-3">
                <p className="text-sm font-semibold">At your target rate of {$(results.requiredHourlyRate, 2)}/hr:</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Revenue per hour</span>
                    <span className="font-medium">{$(results.requiredHourlyRate, 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Employee base (with burden)</span>
                    <span>– {$(budget.employeeBaseHourlyRate * (1 + budget.payrollBurdenPct / 100), 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Excess × {budget.p4pPercentage}% P4P</span>
                    <span className="text-emerald-700 font-medium">
                      + {$(Math.max(0, results.requiredHourlyRate - budget.employeeBaseHourlyRate * (1 + budget.payrollBurdenPct / 100)) * budget.p4pPercentage / 100, 2)}/hr bonus
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Employee earns</span>
                    <span className="text-emerald-700">{$(results.employeeTotalPayPerHour, 2)}/hr effective</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground text-xs">
                    <span>Company labor cost/hr (base + burden + P4P)</span>
                    <span>{$(results.companyLaborCostPerHour, 2)}</span>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* ── Right: Results Panel ── */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="bg-primary text-primary-foreground">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm text-primary-foreground/70">🎯 Target Hourly Rate</CardTitle>
              <p className="text-4xl font-extrabold">
                {results.requiredHourlyRate > 0 ? $(results.requiredHourlyRate, 2) : '—'}
                <span className="text-xl font-normal text-primary-foreground/60"> / hr</span>
              </p>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-primary-foreground/60">
                Rate needed to hit {budget.targetNetMarginPct}% net margin across {results.billableHoursYear.toLocaleString()} billable hours.
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
            <ResultCard label="Net Profit" value={$(results.netProfit)} sub={`${pct(budget.targetNetMarginPct)} margin`} />
            <ResultCard label="Total Costs" value={$(results.totalAnnualCosts)} sub="Labor + overhead" />
            <ResultCard label="Billable Hours" value={results.billableHoursYear.toLocaleString()} sub="Per year" />
          </div>

          {/* Cost breakdown */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Field Labor', val: results.totalLaborCost - budget.ownerSalaryAnnual },
                { label: 'Owner Salary', val: budget.ownerSalaryAnnual },
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
              <p className="text-3xl font-bold">{results.recommendedMarkup}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                To cover overhead ({pct(results.annualOverhead / (results.requiredRevenue || 1) * 100)} of revenue) and hit your profit target.
                Mark up all materials and subcontractor costs by at least this amount.
              </p>
            </CardContent>
          </Card>

          {/* Year over Year */}
          {prevResults && previousBudget && (
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Year-over-Year vs. {previousBudget.year}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: 'Required Rate', curr: results.requiredHourlyRate, prev: prevResults.requiredHourlyRate, fmt: (v: number) => `${$(v, 2)}/hr` },
                  { label: 'Total Costs', curr: results.totalAnnualCosts, prev: prevResults.totalAnnualCosts, fmt: $ },
                  { label: 'Net Profit', curr: results.netProfit, prev: prevResults.netProfit, fmt: $ },
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

          {/* Guidance */}
          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Update this budget each year with your actual expenses. Use the <strong>Revenue Per Hour</strong> report to see which job types, crews, and employees are hitting — or missing — your target rate.</p>
                  <p>Jobs averaging below your target rate need a price increase or efficiency improvement.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
