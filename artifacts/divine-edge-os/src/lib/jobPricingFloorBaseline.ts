import { BudgetYear, DivisionBudget, computeDivision, computeCompanyTotal } from './budgetCalc';
import { JobPricingFloorInputs, defaultJobPricingFloor } from './jobPricingFloor';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Annual on-site CREW clock-hours for a division (not man-hours): one crew on
 * site for one hour counts once regardless of headcount. Uses the same
 * weeks x days x billable hours x efficiency capacity as the man-hour budget.
 */
export function divisionCrewHoursYear(d: DivisionBudget): number {
  const perCrew = d.workWeeksPerYear * d.workDaysPerWeek * d.billableHoursPerDay * (d.productionEfficiencyPct / 100);
  return Math.max(0, d.crewCount) * Math.max(0, perCrew);
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
export function divisionFloorBaseline(d: DivisionBudget): JobPricingFloorInputs {
  const base = defaultJobPricingFloor();
  const res = computeDivision(d);
  const paidPerCrew = Math.max(0, Math.round(d.employeesPerCrew));
  return {
    ...base,
    hourlyWage: paidPerCrew > 0 ? r2(d.avgEmployeeHourlyRate) : 0,
    payrollBurdenPct: r2(d.payrollBurdenPct),
    crewMembers: Math.max(1, paidPerCrew),
    monthlyOverhead: r2(res.monthlyOverhead + d.ownerSalaryAnnual / 12),
    monthlyBillableHours: r2(divisionCrewHoursYear(d) / 12),
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
  const totals = computeCompanyTotal(year);
  let heads = 0, wageSum = 0, burdenWeighted = 0, crews = 0, crewHours = 0, ownerSalaries = 0;
  for (const d of year.divisions) {
    const h = Math.max(0, d.crewCount * d.employeesPerCrew);
    heads += h; wageSum += h * d.avgEmployeeHourlyRate; burdenWeighted += h * d.avgEmployeeHourlyRate * d.payrollBurdenPct;
    crews += Math.max(0, d.crewCount);
    crewHours += divisionCrewHoursYear(d);
    ownerSalaries += d.ownerSalaryAnnual;
  }
  return {
    ...base,
    hourlyWage: heads > 0 ? r2(wageSum / heads) : 0,
    // Wage-weighted so blended burdened labor cost matches the sum of divisions.
    payrollBurdenPct: wageSum > 0 ? r2(burdenWeighted / wageSum) : base.payrollBurdenPct,
    crewMembers: crews > 0 ? Math.max(1, Math.round(heads / crews)) : 1,
    monthlyOverhead: r2((totals.combinedAnnualOverhead + ownerSalaries) / 12),
    monthlyBillableHours: r2(crewHours / 12),
    targetMarginPct: Math.min(99, r2(totals.blendedMarginPct)),
  };
}

/** Inputs with no budget source; seeded with example values the user must review. */
export const SCENARIO_SEED_KEYS: (keyof JobPricingFloorInputs)[] = ['onSiteMinutes', 'driveSetupMinutes', 'directJobCosts'];
