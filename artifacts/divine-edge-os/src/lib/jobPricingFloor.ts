/** A stop-level planning scenario, separate from annual man-hour budget rates. */
export interface JobPricingFloorInputs {
  hourlyWage: number;
  payrollBurdenPct: number;
  crewMembers: number;
  monthlyOverhead: number;
  monthlyBillableHours: number;
  onSiteMinutes: number;
  driveSetupMinutes: number;
  targetMarginPct: number;
  directJobCosts: number;
}

export const defaultJobPricingFloor = (): JobPricingFloorInputs => ({
  hourlyWage: 25,
  payrollBurdenPct: 15,
  crewMembers: 1,
  monthlyOverhead: 3000,
  monthlyBillableHours: 120,
  onSiteMinutes: 45,
  driveSetupMinutes: 15,
  targetMarginPct: 20,
  directJobCosts: 0,
});

export interface JobPricingFloorResult {
  burdenedWage: number;
  crewLaborHourly: number;
  overheadPerBillableHour: number;
  totalClockMinutes: number;
  laborCost: number;
  overheadShare: number;
  directJobCosts: number;
  breakEvenFloor: number;
  trueHourlyCost: number;
  recommendedMinimum: number;
  profitAtMinimum: number;
  costPerClockMinute: number;
  revenuePerClockMinute: number;
}

export function calculateJobPricingFloor(input: JobPricingFloorInputs): {
  errors: string[];
  result: JobPricingFloorResult | null;
} {
  const labels: Record<keyof JobPricingFloorInputs, string> = {
    hourlyWage: 'Hourly wage', payrollBurdenPct: 'Payroll burden',
    crewMembers: 'Crew members', monthlyOverhead: 'Monthly overhead',
    monthlyBillableHours: 'Monthly billable hours', onSiteMinutes: 'On-site time',
    driveSetupMinutes: 'Drive and setup time', targetMarginPct: 'Target profit margin',
    directJobCosts: 'Other direct job costs',
  };
  const errors: string[] = [];
  for (const key of Object.keys(labels) as (keyof JobPricingFloorInputs)[]) {
    if (!Number.isFinite(input[key]) || input[key] < 0) {
      errors.push(`${labels[key]} must be a finite, non-negative number.`);
    }
  }
  if (!Number.isSafeInteger(input.crewMembers) || input.crewMembers < 1) {
    errors.push('Crew members must be a whole number of at least 1.');
  }
  if (input.monthlyBillableHours <= 0) errors.push('Monthly billable hours must be greater than 0.');
  if (input.onSiteMinutes <= 0) errors.push('On-site time must be greater than 0.');
  if (input.targetMarginPct >= 100) errors.push('Target profit margin must be less than 100%.');
  if (errors.length) return { errors, result: null };

  const burdenedWage = input.hourlyWage * (1 + input.payrollBurdenPct / 100);
  const crewLaborHourly = burdenedWage * input.crewMembers;
  const overheadPerBillableHour = input.monthlyOverhead / input.monthlyBillableHours;
  const totalClockMinutes = input.onSiteMinutes + input.driveSetupMinutes;
  const laborCost = crewLaborHourly * totalClockMinutes / 60;
  // Hours are on-site CREW clock-hours, not employee man-hours. Overhead is
  // recovered only from on-site hours; charging it again on drive time would
  // over-allocate the monthly overhead entered above.
  const overheadShare = overheadPerBillableHour * input.onSiteMinutes / 60;
  const breakEvenFloor = laborCost + overheadShare + input.directJobCosts;
  const unroundedPrice = breakEvenFloor / (1 - input.targetMarginPct / 100);
  // Round UP to a cent so displayed recommended prices never miss the margin.
  const recommendedMinimum = Math.ceil(unroundedPrice * 100 - 1e-8) / 100;
  const result: JobPricingFloorResult = {
    burdenedWage, crewLaborHourly, overheadPerBillableHour, totalClockMinutes,
    laborCost, overheadShare, directJobCosts: input.directJobCosts,
    breakEvenFloor,
    // Includes travel labor and direct costs, expressed per on-site billable hour.
    trueHourlyCost: breakEvenFloor / (input.onSiteMinutes / 60),
    recommendedMinimum, profitAtMinimum: recommendedMinimum - breakEvenFloor,
    costPerClockMinute: breakEvenFloor / totalClockMinutes,
    revenuePerClockMinute: recommendedMinimum / totalClockMinutes,
  };
  if (Object.values(result).some(value => !Number.isFinite(value))) {
    return { errors: ['These inputs produce an out-of-range result. Reduce the values and try again.'], result: null };
  }
  return { errors: [], result };
}

/** Preserve only valid, complete saved scenarios; old budget records remain valid. */
export function restoreJobPricingFloor(raw: unknown): JobPricingFloorInputs | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const restored = { ...defaultJobPricingFloor() };
  for (const key of Object.keys(restored) as (keyof JobPricingFloorInputs)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    restored[key] = value;
  }
  return calculateJobPricingFloor(restored).result ? restored : undefined;
}
