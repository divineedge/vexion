import { BudgetYear, DivisionBudget, capacityWeeks, computeDivision, resolvedWeeklyBillableHours } from './budgetCalc';
import { JobPricingFloorInputs, defaultJobPricingFloor } from './jobPricingFloor';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Paid field employees. The owner is not included; owner pay is recovered in overhead. */
export function fieldEmployeeCount(d: DivisionBudget): number {
  return Math.max(0, Number(d.crewCount) || 0) * Math.max(0, Number(d.employeesPerCrew) || 0);
}

/**
 * Annual on-site CREW hours. Weekly billable hours are already productive hours,
 * so production efficiency is not applied again. Seasonal divisions use weeks
 * worked. Year-round divisions use the company annual working weeks.
 * A 52-week year is weekly hours × 52 / 12 (about 4.333 weeks per month).
 */
export function divisionCrewHoursYear(d: DivisionBudget, annualWorkingWeeks?: number): number {
  const weeks = capacityWeeks(d, annualWorkingWeeks);
  const weekly = resolvedWeeklyBillableHours(d);
  return Math.max(0, Number(d.crewCount) || 0) * Math.max(0, weekly) * Math.max(0, weeks);
}

/**
 * Budget-derived stop scenario for one division.
 * - Wage/burden: employee wage rate and payroll burden from the division.
 * - Crew members: paid employees per crew (min 1). The owner is NOT added as
 *   hourly labor; owner salary is recovered through overhead instead, so it is
 *   never counted twice.
 * - Overhead: division monthly overhead + owner salary / 12.
 * - Billable hours: crew-hours per month (annual crew-hours / 12).
 * Billable hours are left at 0 when the budget has no crew capacity, so the
 * shared validation forces the user to enter real hours.
 * Stop times and direct job costs have no budget source; they are scenario seeds.
 */
export function divisionFloorBaseline(d: DivisionBudget, annualWorkingWeeks?: number): JobPricingFloorInputs {
  const base = defaultJobPricingFloor();
  const res = computeDivision(d, annualWorkingWeeks);
  const paidEmployees = fieldEmployeeCount(d);
  const paidPerCrew = Math.max(0, Math.round(Number(d.employeesPerCrew) || 0));
  return {
    ...base,
    hourlyWage: paidEmployees > 0 ? r2(Number(d.avgEmployeeHourlyRate) || 0) : 0,
    payrollBurdenPct: r2(Number(d.payrollBurdenPct) || 0),
    crewMembers: Math.max(1, paidPerCrew),
    monthlyOverhead: r2(res.monthlyOverhead + (Number(d.ownerSalaryAnnual) || 0) / 12),
    monthlyBillableHours: r2(divisionCrewHoursYear(d, annualWorkingWeeks) / 12),
    targetMarginPct: Math.min(99, r2(d.targetNetMarginPct)),
  };
}

/**
 * Company-wide baseline. Overhead uses the Company Total effective overhead
 * (honours overrides for shared costs) plus all owner salaries; wage and burden
 * are weighted by paid employee headcount; crew-hours are summed per division.
 */
export function companyFloorBaseline(year: BudgetYear): JobPricingFloorInputs {
  const base = defaultJobPricingFloor();
  let heads = 0, wageSum = 0, burdenWeighted = 0, crews = 0, crewHours = 0, ownerSalaries = 0, expenseMonthly = 0, marginWeighted = 0, marginWeight = 0;
  for (const d of year.divisions) {
    const result = computeDivision(d, year.annualWorkingWeeks);
    const h = fieldEmployeeCount(d);
    const wage = Number(d.avgEmployeeHourlyRate) || 0;
    const burden = Number(d.payrollBurdenPct) || 0;
    heads += h;
    wageSum += h * wage;
    burdenWeighted += h * wage * burden;
    crews += Math.max(0, Number(d.crewCount) || 0);
    crewHours += divisionCrewHoursYear(d, year.annualWorkingWeeks);
    ownerSalaries += Number(d.ownerSalaryAnnual) || 0;
    expenseMonthly += result.monthlyOverhead;
    const weight = result.totalAnnualCosts;
    marginWeighted += d.targetNetMarginPct * weight;
    marginWeight += weight;
  }
  return {
    ...base,
    hourlyWage: heads > 0 ? r2(wageSum / heads) : 0,
    // Wage-weighted so blended burdened labor cost matches the sum of divisions.
    payrollBurdenPct: wageSum > 0 ? r2(burdenWeighted / wageSum) : base.payrollBurdenPct,
    crewMembers: crews > 0 ? Math.max(1, Math.round(heads / crews)) : 1,
    monthlyOverhead: r2(expenseMonthly + ownerSalaries / 12),
    monthlyBillableHours: r2(crewHours / 12),
    targetMarginPct: Math.min(99, r2(marginWeight > 0 ? marginWeighted / marginWeight : 0)),
  };
}

/** Fields the floor copies from the budget. Edits in the budget replace these unless the user overrode that field in this session. */
export const BUDGET_LINKED_FLOOR_KEYS: (keyof JobPricingFloorInputs)[] = [
  'hourlyWage', 'payrollBurdenPct', 'crewMembers', 'monthlyOverhead', 'monthlyBillableHours', 'targetMarginPct',
];

/** Budget fields follow `baseline`. Saved stop-time and direct-cost edits stay. Session edits win over both. */
export function presentFloorInputs(
  baseline: JobPricingFloorInputs,
  saved: JobPricingFloorInputs | undefined,
  session: Partial<JobPricingFloorInputs>,
): JobPricingFloorInputs {
  const merged: JobPricingFloorInputs = { ...baseline };
  if (saved) {
    for (const key of SCENARIO_SEED_KEYS) merged[key] = saved[key];
  }
  for (const key of Object.keys(session) as (keyof JobPricingFloorInputs)[]) {
    const value = session[key];
    if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
  }
  return merged;
}

/** Inputs with no budget source; seeded with example values the user must review. */
export const SCENARIO_SEED_KEYS: (keyof JobPricingFloorInputs)[] = ['onSiteMinutes', 'driveSetupMinutes', 'directJobCosts'];
