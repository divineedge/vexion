import { restoreJobPricingFloor, type JobPricingFloorInputs } from './jobPricingFloor';

export type ExpenseFrequency = 'monthly' | 'annual';

/** Saved lines without a frequency stay monthly, which is how those amounts were entered. */
export function expenseFrequency(value: unknown): ExpenseFrequency {
  return value === 'annual' ? 'annual' : 'monthly';
}

export function annualizedExpense(amount: number, frequency: ExpenseFrequency = 'monthly'): number {
  const value = Number(amount) || 0;
  return frequency === 'annual' ? value : value * 12;
}

export function monthlyExpense(amount: number, frequency: ExpenseFrequency = 'monthly'): number {
  const value = Number(amount) || 0;
  return frequency === 'annual' ? value / 12 : value;
}

/** Keep a partial entry untouched. Clamp only a finished value to 1–52. */
export function clampAnnualWorkingWeeks(raw: string, fallback = 48): number {
  if (raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(52, Math.max(1, Math.round(value)));
}

// ── Shared types & math for the Budget Calculator ──────────────────────────
// Kept out of the page component so division panels, the company-total
// rollup, and the checkup comparisons can all share one source of truth.

export interface OverheadLineItems {
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
}

export const OVERHEAD_CATEGORIES: { key: keyof OverheadLineItems; label: string }[] = [
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

export interface CustomOverheadLine {
  id: string;
  name: string;
  /** Monthly equivalent. Older readers sum this. New readers use amount plus frequency. */
  monthlyAmount: number;
  /** Typed amount. Missing on older lines, which are monthly and use monthlyAmount. */
  amount?: number;
  frequency?: ExpenseFrequency;
}

export type OverheadPayType = 'annual_salary' | 'hourly';
/** division: this division's overhead. company_proportional: split by productive hours. company_total: company overhead only. */
export type OverheadLaborAllocation = 'division' | 'company_proportional' | 'company_total';

/** Non-billable office, shop, and sales labor recovered through overhead. */
export interface OverheadLaborRole {
  id: string;
  /** Role or employee name. */
  name: string;
  payType: OverheadPayType;
  /** Annual salary when pay type is annual_salary. */
  annualAmount: number;
  /** Hourly rate when pay type is hourly. */
  hourlyRate: number;
  /** Hours per week when pay type is hourly. */
  hoursPerWeek: number;
  /** Use the division payroll burden % when true. */
  inheritBurden: boolean;
  /** Used when inheritBurden is false. */
  payrollBurdenPct: number;
  allocation: OverheadLaborAllocation;
}

export const OVERHEAD_LABOR_PRESETS: { id: string; name: string }[] = [
  { id: 'owner_admin', name: 'Owner/Admin Salary' },
  { id: 'office_manager', name: 'Office Manager' },
  { id: 'shop_mechanic', name: 'Shop Mechanic' },
  { id: 'sales_estimating', name: 'Sales/Estimating' },
];

export function newOverheadLaborRole(name = ''): OverheadLaborRole {
  return {
    id: crypto.randomUUID(),
    name,
    payType: 'annual_salary',
    annualAmount: 0,
    hourlyRate: 0,
    hoursPerWeek: 40,
    inheritBurden: true,
    payrollBurdenPct: 0,
    allocation: 'division',
  };
}

export type TechnicianSchedule = 'year_round' | 'seasonal';

const zeroOverhead = (): OverheadLineItems => ({
  vehiclePayments: 0, fuelMaintenance: 0, generalLiabilityInsurance: 0, vehicleInsurance: 0,
  workersComp: 0, equipmentPayments: 0, equipmentRepair: 0, officeRent: 0, marketingAdvertising: 0,
  softwareSubscriptions: 0, phoneCommunication: 0, uniformsPPE: 0, accountingLegal: 0, miscOverhead: 0,
});

// ── Checkups (actual vs. budget) ────────────────────────────────────────────
export interface CheckupData {
  actualRevenue: number;
  actualLaborCost: number;
  actualMaterialCost: number;
  actualOverhead: Partial<OverheadLineItems>;
  notes: string;
  completedAt?: string;
}

export function defaultCheckup(): CheckupData {
  return { actualRevenue: 0, actualLaborCost: 0, actualMaterialCost: 0, actualOverhead: {}, notes: '' };
}

function migrateCheckup(raw: any): CheckupData {
  if (!raw || typeof raw !== 'object') return defaultCheckup();
  return {
    actualRevenue: Number(raw.actualRevenue) || 0,
    actualLaborCost: Number(raw.actualLaborCost) || 0,
    actualMaterialCost: Number(raw.actualMaterialCost) || 0,
    actualOverhead: (raw.actualOverhead && typeof raw.actualOverhead === 'object') ? raw.actualOverhead : {},
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
  };
}

// ── Division budget (one full budget per line of business) ─────────────────
export interface DivisionBudget extends OverheadLineItems {
  id: string;
  name: string;
  serviceIds: number[];
  /** Annual revenue entered on this division. */
  revenue?: number;
  /** Annual income used to split company overhead. Entered on Company Total. */
  income?: number;
  crewCount: number;
  workWeeksPerYear: number;
  workDaysPerWeek: number;
  billableHoursPerDay: number;
  /** Billable hours each technician can sell in a working week. When omitted, days × hours/day is used. */
  weeklyBillableHours?: number;
  technicianSchedule?: TechnicianSchedule;
  /** Production weeks for a seasonal crew. Year-round crews use the company annual working weeks. */
  weeksWorkedPerYear?: number;
  /** Seasonal crews paid through the off-season. Those wages are overhead, not productive labor. */
  yearRoundPay?: boolean;
  customOverhead?: CustomOverheadLine[];
  /** Non-billable salaried and hourly overhead roles. Missing on older budgets. */
  overheadLabor?: OverheadLaborRole[];
  /** Manual division job floor. Null follows the calculated cost baseline. */
  floorPriceOverride?: number | null;
  productionEfficiencyPct: number;
  ownerSalaryAnnual: number;
  ownerWorksInField: boolean;
  employeesPerCrew: number;
  avgEmployeeHourlyRate: number;
  avgEmployeeHoursPerWeek: number;
  payrollBurdenPct: number;
  targetNetMarginPct: number;
  employeeBaseHourlyRate: number;
  p4pPercentage: number;
  /** Typed COGS / supplies amount. Annual unless materialFrequency is monthly. */
  estimatedAnnualMaterialCost: number;
  /**
   * Missing frequency stays annual. Older budgets stored this amount as a yearly
   * material total, so treating a missing key as monthly would multiply it by 12.
   */
  materialFrequency?: ExpenseFrequency;
  /** Salary / payroll expense besides overhead labor roles and field wages. */
  salaryPayroll?: number;
  /** Missing frequency is monthly, same as the other expense lines. */
  salaryPayrollFrequency?: ExpenseFrequency;
  minimumVisitHours: number;
  /** Per standard overhead line. Missing keys are monthly. */
  overheadFrequency: Partial<Record<keyof OverheadLineItems, ExpenseFrequency>>;
  midYearCheckup: CheckupData;
  endYearCheckup: CheckupData;
  /** Saved stop-level floor scenario for this division; undefined = follow budget-derived baseline. */
  jobPricingFloor?: JobPricingFloorInputs;
}

export function defaultDivision(name = 'Main'): DivisionBudget {
  return {
    id: crypto.randomUUID(),
    name,
    serviceIds: [],
    revenue: 0,
    income: 0,
    crewCount: 2,
    workWeeksPerYear: 32,
    workDaysPerWeek: 5,
    billableHoursPerDay: 8,
    technicianSchedule: 'year_round',
    weeksWorkedPerYear: 32,
    yearRoundPay: false,
    customOverhead: [],
    overheadLabor: [],
    overheadFrequency: {},
    floorPriceOverride: null,
    productionEfficiencyPct: 80,
    ownerSalaryAnnual: 65000,
    ownerWorksInField: true,
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
    estimatedAnnualMaterialCost: 0,
    salaryPayroll: 0,
    minimumVisitHours: 1,
    midYearCheckup: defaultCheckup(),
    endYearCheckup: defaultCheckup(),
  };
}

function normalizeFrequencyMap(raw: unknown): Partial<Record<keyof OverheadLineItems, ExpenseFrequency>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<keyof OverheadLineItems, ExpenseFrequency>> = {};
  for (const { key } of OVERHEAD_CATEGORIES) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === 'annual' || value === 'monthly') out[key] = value;
  }
  return out;
}

function normalizeCompanyOverhead(raw: unknown): Partial<OverheadLineItems> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<OverheadLineItems> = {};
  for (const { key } of OVERHEAD_CATEGORIES) {
    const value = Number((raw as Record<string, unknown>)[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

/** Annual company overhead entered for one category. Monthly amounts are multiplied by 12. */
export function companyCategoryOverheadAnnual(year: BudgetYear, key: keyof OverheadLineItems): number {
  return annualizedExpense(Number(year.companyOverhead?.[key]) || 0, expenseFrequency(year.companyOverheadFrequency?.[key]));
}

/**
 * This division's share of one company overhead category.
 * division income / total division income × category overhead.
 * Returns null when total income is zero so callers show nothing.
 */
export function companyOverheadShare(divisionIncome: number, divisionIncomes: number[], categoryOverhead: number): number | null {
  const total = divisionIncomes.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (!(total > 0)) return null;
  const income = Math.max(0, Number(divisionIncome) || 0);
  const overhead = Number(categoryOverhead) || 0;
  return (income / total) * overhead;
}

export function customLineAmount(line: CustomOverheadLine): number {
  return typeof line.amount === 'number' && Number.isFinite(line.amount) ? line.amount : (Number(line.monthlyAmount) || 0);
}

export function customLineFrequency(line: CustomOverheadLine): ExpenseFrequency {
  return expenseFrequency(line.frequency);
}

export function customLineWithAmount(line: CustomOverheadLine, amount: number): CustomOverheadLine {
  const frequency = customLineFrequency(line);
  return { ...line, amount, frequency, monthlyAmount: monthlyExpense(amount, frequency) };
}

export function customLineWithFrequency(line: CustomOverheadLine, frequency: ExpenseFrequency): CustomOverheadLine {
  const amount = customLineAmount(line);
  return { ...line, amount, frequency, monthlyAmount: monthlyExpense(amount, frequency) };
}

function normalizeCustomOverheadLine(line: any): CustomOverheadLine[] {
  const name = typeof line?.name === 'string' ? line.name.trim() : '';
  const frequency = line?.frequency === 'annual' || line?.frequency === 'monthly' ? line.frequency : 'monthly';
  const typed = Number(line?.amount);
  const monthlyAmount = Number(line?.monthlyAmount);
  const amount = Number.isFinite(typed) ? typed : (Number.isFinite(monthlyAmount) ? monthlyAmount : NaN);
  if (!name || !Number.isFinite(amount) || amount < 0) return [];
  return [{
    id: typeof line.id === 'string' && line.id ? line.id : crypto.randomUUID(),
    name,
    amount,
    frequency,
    monthlyAmount: monthlyExpense(amount, frequency),
  }];
}

export function categoryAnnualAmount(d: DivisionBudget, key: keyof OverheadLineItems): number {
  return annualizedExpense(Number(d[key]) || 0, expenseFrequency(d.overheadFrequency?.[key]));
}

function nonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeOverheadLaborRole(raw: any): OverheadLaborRole | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const payType: OverheadPayType = raw.payType === 'hourly' ? 'hourly' : 'annual_salary';
  const allocation: OverheadLaborAllocation = raw.allocation === 'company_proportional' || raw.allocation === 'company_total'
    ? raw.allocation
    : 'division';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name,
    payType,
    annualAmount: nonNegative(raw.annualAmount),
    hourlyRate: nonNegative(raw.hourlyRate),
    hoursPerWeek: nonNegative(raw.hoursPerWeek),
    inheritBurden: raw.inheritBurden !== false,
    payrollBurdenPct: nonNegative(raw.payrollBurdenPct),
    allocation,
  };
}

/** Working weeks for hourly overhead. Company working weeks win over a seasonal crew's production weeks. */
export function overheadLaborWorkingWeeks(division: DivisionBudget, annualWorkingWeeks?: number): number {
  if (typeof annualWorkingWeeks === 'number' && Number.isFinite(annualWorkingWeeks) && annualWorkingWeeks > 0) return annualWorkingWeeks;
  return nonNegative(division.workWeeksPerYear);
}

export function overheadLaborBurdenPct(role: OverheadLaborRole, inheritedPct: number): number {
  if (role.inheritBurden !== false) return nonNegative(inheritedPct);
  return nonNegative(role.payrollBurdenPct);
}

/** Annual pay before payroll tax. Hourly is rate × hours/week × working weeks. */
export function overheadLaborBasePay(role: OverheadLaborRole, workingWeeks: number): number {
  if (role.payType === 'hourly') return nonNegative(role.hourlyRate) * nonNegative(role.hoursPerWeek) * nonNegative(workingWeeks);
  return nonNegative(role.annualAmount);
}

export function overheadLaborAnnualCost(role: OverheadLaborRole, workingWeeks: number, inheritedBurdenPct: number): number {
  const base = overheadLaborBasePay(role, workingWeeks);
  return base * (1 + overheadLaborBurdenPct(role, inheritedBurdenPct) / 100);
}

export interface OverheadLaborLine {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  payType: OverheadPayType;
  allocation: OverheadLaborAllocation;
  annualCost: number;
  monthlyCost: number;
}

export function listOverheadLabor(year: BudgetYear, annualWorkingWeeks?: number): OverheadLaborLine[] {
  const weeksArg = typeof annualWorkingWeeks === 'number' && annualWorkingWeeks > 0 ? annualWorkingWeeks : year.annualWorkingWeeks;
  const lines: OverheadLaborLine[] = [];
  for (const division of year.divisions) {
    const weeks = overheadLaborWorkingWeeks(division, weeksArg);
    for (const role of division.overheadLabor ?? []) {
      const annualCost = overheadLaborAnnualCost(role, weeks, division.payrollBurdenPct);
      lines.push({
        id: role.id,
        divisionId: division.id,
        divisionName: division.name,
        name: role.name,
        payType: role.payType,
        allocation: role.allocation ?? 'division',
        annualCost,
        monthlyCost: annualCost / 12,
      });
    }
  }
  return lines;
}

export function summarizeOverheadLabor(year: BudgetYear, annualWorkingWeeks?: number) {
  let divisionAllocated = 0;
  let proportional = 0;
  let companyOnly = 0;
  for (const line of listOverheadLabor(year, annualWorkingWeeks)) {
    if (line.allocation === 'company_proportional') proportional += line.annualCost;
    else if (line.allocation === 'company_total') companyOnly += line.annualCost;
    else divisionAllocated += line.annualCost;
  }
  return { divisionAllocated, proportional, companyOnly, total: divisionAllocated + proportional + companyOnly };
}

// Migrates a single legacy "flat" budget object (pre-divisions) into a division.
function migrateFlatToDivision(raw: any, name = 'Main'): DivisionBudget {
  const base = defaultDivision(name);
  const merged: DivisionBudget = { ...base, ...raw, id: raw.id ?? base.id, name: raw.name ?? name };
  merged.midYearCheckup = migrateCheckup(raw.midYearCheckup);
  merged.endYearCheckup = migrateCheckup(raw.endYearCheckup);
  merged.jobPricingFloor = restoreJobPricingFloor(raw.jobPricingFloor);
  merged.estimatedAnnualMaterialCost = nonNegative(raw.estimatedAnnualMaterialCost);
  merged.materialFrequency = raw.materialFrequency === 'monthly' || raw.materialFrequency === 'annual'
    ? raw.materialFrequency
    : undefined;
  merged.salaryPayroll = nonNegative(raw.salaryPayroll);
  merged.salaryPayrollFrequency = raw.salaryPayrollFrequency === 'monthly' || raw.salaryPayrollFrequency === 'annual'
    ? raw.salaryPayrollFrequency
    : undefined;
  merged.minimumVisitHours = raw.minimumVisitHours != null && Number.isFinite(Number(raw.minimumVisitHours))
    ? Math.max(0, Number(raw.minimumVisitHours)) : 1;
  merged.serviceIds = Array.isArray(raw.serviceIds)
    ? [...new Set<number>(raw.serviceIds.filter((id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))] : [];
  merged.weeklyBillableHours = Number.isFinite(Number(raw.weeklyBillableHours))
    ? Math.max(0, Number(raw.weeklyBillableHours))
    : Math.max(0, Number(merged.workDaysPerWeek) || 0) * Math.max(0, Number(merged.billableHoursPerDay) || 0);
  merged.technicianSchedule = raw.technicianSchedule === 'seasonal' ? 'seasonal' : 'year_round';
  merged.weeksWorkedPerYear = Number.isFinite(Number(raw.weeksWorkedPerYear))
    ? Math.max(0, Number(raw.weeksWorkedPerYear))
    : merged.workWeeksPerYear;
  merged.yearRoundPay = raw.yearRoundPay === true;
  merged.customOverhead = Array.isArray(raw.customOverhead)
    ? raw.customOverhead.flatMap((line: any) => normalizeCustomOverheadLine(line))
    : [];
  merged.overheadLabor = Array.isArray(raw.overheadLabor)
    ? raw.overheadLabor.flatMap((line: any) => {
      const role = normalizeOverheadLaborRole(line);
      return role ? [role] : [];
    })
    : [];
  merged.overheadFrequency = normalizeFrequencyMap(raw.overheadFrequency);
  merged.revenue = nonNegative(raw.revenue);
  merged.income = nonNegative(raw.income);
  merged.floorPriceOverride = typeof raw.floorPriceOverride === 'number' && Number.isFinite(raw.floorPriceOverride) && raw.floorPriceOverride >= 0
    ? raw.floorPriceOverride : null;
  return merged;
}

// ── Budget year (all divisions + company-level rollup adjustments) ─────────
export interface BudgetYear {
  year: number;
  divisions: DivisionBudget[];
  overheadOverrides: Partial<OverheadLineItems>;
  /** Weeks the company actually produces. Overhead and year-round payroll use this, not a 12-month average. */
  annualWorkingWeeks?: number;
  /** Manual company-wide job floor. Null follows the aggregated division baseline. */
  companyFloorPriceOverride?: number | null;
  companyMidYearCheckup: CheckupData;
  companyEndYearCheckup: CheckupData;
  savedAt?: string;
  /** Annual company revenue entered on the checkup review. */
  companyTotalRevenue?: number;
  /** Company overhead entered per category on the checkup review. */
  companyOverhead?: Partial<OverheadLineItems>;
  companyOverheadFrequency?: Partial<Record<keyof OverheadLineItems, ExpenseFrequency>>;
  /** Company-level COGS / supplies not already entered on a division. */
  companyCogs?: number;
  companyCogsFrequency?: ExpenseFrequency;
  /** Company-level salary / payroll not already entered on a division or overhead role. */
  companySalaryPayroll?: number;
  companySalaryPayrollFrequency?: ExpenseFrequency;
  jobPricingFloor?: JobPricingFloorInputs;
  /** Company-wide stop floor scenario; undefined = follow budget-derived baseline. */
  companyJobPricingFloor?: JobPricingFloorInputs;
}

export function defaultBudgetYear(year = new Date().getFullYear()): BudgetYear {
  return {
    year,
    divisions: [defaultDivision('Main')],
    overheadOverrides: {},
    annualWorkingWeeks: 48,
    companyTotalRevenue: 0,
    companyOverhead: {},
    companyOverheadFrequency: {},
    companyCogs: 0,
    companySalaryPayroll: 0,
    companyFloorPriceOverride: null,
    companyMidYearCheckup: defaultCheckup(),
    companyEndYearCheckup: defaultCheckup(),
  };
}

/** Copy a budget into another year without marking it saved. Later edits to the source stay there. */
export function carryForwardBudgetYear(source: BudgetYear, year: number): BudgetYear {
  const copy = structuredClone(source);
  copy.year = year;
  delete copy.savedAt;
  return copy;
}

/**
 * Use the year already stored when it exists.
 * The first visit to a missing year copies the latest earlier year (or the only year on file)
 * so its divisions, prices, and checkup review come along. A later visit returns the stored year.
 */
export function resolveBudgetYear(years: BudgetYear[], year: number): BudgetYear {
  const existing = years.find(item => item.year === year);
  if (existing) return existing;
  const earlier = years.filter(item => item.year < year).sort((a, b) => b.year - a.year);
  const source = earlier[0] ?? [...years].sort((a, b) => b.year - a.year)[0];
  if (!source) return defaultBudgetYear(year);
  return carryForwardBudgetYear(source, year);
}

// Accepts whatever shape was previously saved (flat single-budget object,
// legacy array-of-flat-years, or the current { year, divisions[] } shape)
// and normalizes it into BudgetYear[].
export function migrateBudgetPayload(saved: unknown): BudgetYear[] {
  if (!saved) return [];
  const rawList = Array.isArray(saved) ? saved : [saved];
  return rawList.map((raw: any) => {
    if (raw && Array.isArray(raw.divisions)) {
      return {
        year: raw.year ?? new Date().getFullYear(),
        divisions: raw.divisions.length > 0
          ? raw.divisions.map((d: any) => migrateFlatToDivision(d, d.name ?? 'Main'))
          : [defaultDivision('Main')],
        overheadOverrides: (raw.overheadOverrides && typeof raw.overheadOverrides === 'object') ? raw.overheadOverrides : {},
        annualWorkingWeeks: Number.isFinite(Number(raw.annualWorkingWeeks)) && Number(raw.annualWorkingWeeks) > 0
          ? clampAnnualWorkingWeeks(String(raw.annualWorkingWeeks), 48) : 48,
        companyTotalRevenue: nonNegative(raw.companyTotalRevenue),
        companyOverhead: normalizeCompanyOverhead(raw.companyOverhead),
        companyOverheadFrequency: normalizeFrequencyMap(raw.companyOverheadFrequency),
        companyCogs: nonNegative(raw.companyCogs),
        companyCogsFrequency: expenseFrequency(raw.companyCogsFrequency),
        companySalaryPayroll: nonNegative(raw.companySalaryPayroll),
        companySalaryPayrollFrequency: expenseFrequency(raw.companySalaryPayrollFrequency),
        companyFloorPriceOverride: typeof raw.companyFloorPriceOverride === 'number' && Number.isFinite(raw.companyFloorPriceOverride) && raw.companyFloorPriceOverride >= 0
          ? raw.companyFloorPriceOverride : null,
        companyMidYearCheckup: migrateCheckup(raw.companyMidYearCheckup),
        companyEndYearCheckup: migrateCheckup(raw.companyEndYearCheckup),
        savedAt: raw.savedAt,
        jobPricingFloor: restoreJobPricingFloor(raw.jobPricingFloor),
        companyJobPricingFloor: restoreJobPricingFloor(raw.companyJobPricingFloor),
      };
    }
    // Legacy flat shape: the whole object IS a single division's fields.
    return {
      year: raw?.year ?? new Date().getFullYear(),
      divisions: [migrateFlatToDivision(raw ?? {}, 'Main')],
      overheadOverrides: {},
      annualWorkingWeeks: 48,
      companyTotalRevenue: nonNegative(raw?.companyTotalRevenue),
      companyOverhead: normalizeCompanyOverhead(raw?.companyOverhead),
      companyOverheadFrequency: normalizeFrequencyMap(raw?.companyOverheadFrequency),
      companyCogs: nonNegative(raw?.companyCogs),
      companyCogsFrequency: expenseFrequency(raw?.companyCogsFrequency),
      companySalaryPayroll: nonNegative(raw?.companySalaryPayroll),
      companySalaryPayrollFrequency: expenseFrequency(raw?.companySalaryPayrollFrequency),
      companyFloorPriceOverride: null,
      companyMidYearCheckup: defaultCheckup(),
      companyEndYearCheckup: defaultCheckup(),
      savedAt: raw?.savedAt,
      jobPricingFloor: restoreJobPricingFloor(raw?.jobPricingFloor),
    };
  });
}

export function resolvedWeeklyBillableHours(d: DivisionBudget): number {
  if (typeof d.weeklyBillableHours === 'number' && Number.isFinite(d.weeklyBillableHours)) return Math.max(0, d.weeklyBillableHours);
  return Math.max(0, d.workDaysPerWeek) * Math.max(0, d.billableHoursPerDay);
}

/** Production weeks. Seasonal crews use weeks worked. Year-round crews use the company working-week setting when it is provided. */
export function capacityWeeks(d: DivisionBudget, annualWorkingWeeks?: number): number {
  if (d.technicianSchedule === 'seasonal') {
    const worked = Number(d.weeksWorkedPerYear);
    return Number.isFinite(worked) && worked > 0 ? worked : d.workWeeksPerYear;
  }
  if (d.technicianSchedule === 'year_round' && typeof annualWorkingWeeks === 'number' && annualWorkingWeeks > 0) return annualWorkingWeeks;
  return d.workWeeksPerYear;
}

export function payrollWeeks(d: DivisionBudget, capacity: number, annualWorkingWeeks?: number): number {
  const fullYear = typeof annualWorkingWeeks === 'number' && annualWorkingWeeks > 0 ? annualWorkingWeeks : d.workWeeksPerYear;
  if (d.technicianSchedule === 'seasonal' && d.yearRoundPay) return fullYear;
  return capacity;
}

export function customOverheadMonthly(d: DivisionBudget): number {
  return (d.customOverhead ?? []).reduce((sum, line) => sum + monthlyExpense(customLineAmount(line), customLineFrequency(line)), 0);
}

export function customOverheadAnnual(d: DivisionBudget): number {
  return (d.customOverhead ?? []).reduce((sum, line) => sum + annualizedExpense(customLineAmount(line), customLineFrequency(line)), 0);
}

/** COGS stays annual when the frequency was never saved. */
export function materialExpenseFrequency(value: unknown): ExpenseFrequency {
  return value === 'monthly' ? 'monthly' : 'annual';
}

/** Annual COGS / supplies. A monthly line is multiplied by 12. An annual line is used as entered. */
export function materialCostAnnual(d: Pick<DivisionBudget, 'estimatedAnnualMaterialCost' | 'materialFrequency'>): number {
  return annualizedExpense(Number(d.estimatedAnnualMaterialCost) || 0, materialExpenseFrequency(d.materialFrequency));
}

/** Annual salary / payroll expense line. Missing frequency is monthly. */
export function salaryPayrollAnnual(d: Pick<DivisionBudget, 'salaryPayroll' | 'salaryPayrollFrequency'>): number {
  return annualizedExpense(Number(d.salaryPayroll) || 0, expenseFrequency(d.salaryPayrollFrequency));
}

export function companyCogsAnnual(year: Pick<BudgetYear, 'companyCogs' | 'companyCogsFrequency'>): number {
  return annualizedExpense(Number(year.companyCogs) || 0, expenseFrequency(year.companyCogsFrequency));
}

export function companySalaryAnnual(year: Pick<BudgetYear, 'companySalaryPayroll' | 'companySalaryPayrollFrequency'>): number {
  return annualizedExpense(Number(year.companySalaryPayroll) || 0, expenseFrequency(year.companySalaryPayrollFrequency));
}

/** Division revenue and Company Total income are one entered amount. */
export function divisionWithSharedRevenue(division: DivisionBudget, amount: number): DivisionBudget {
  const value = Math.max(0, Number(amount) || 0);
  return { ...division, income: value, revenue: value };
}

export function calculatedJobFloor(d: Pick<DivisionBudget, 'estimatedAnnualMaterialCost' | 'materialFrequency' | 'minimumVisitHours'>, results: { totalLaborCost: number; annualOverhead: number; manHoursYear: number }): number {
  if (!(results.manHoursYear > 0)) return 0;
  const cost = results.totalLaborCost + results.annualOverhead + materialCostAnnual(d);
  return (cost / results.manHoursYear) * Math.max(0, Number(d.minimumVisitHours) || 0);
}

export function effectiveJobFloor(calculated: number, override: number | null | undefined): number {
  return typeof override === 'number' && Number.isFinite(override) && override >= 0 ? override : calculated;
}

// ── Division-level computed results ─────────────────────────────────────────
export function divisionAllocatedLaborAnnual(d: DivisionBudget, annualWorkingWeeks?: number): number {
  const weeks = overheadLaborWorkingWeeks(d, annualWorkingWeeks);
  return (d.overheadLabor ?? []).reduce((sum, role) => {
    if (role.allocation === 'company_proportional' || role.allocation === 'company_total') return sum;
    return sum + overheadLaborAnnualCost(role, weeks, d.payrollBurdenPct);
  }, 0);
}

export function computeDivision(d: DivisionBudget, annualWorkingWeeks?: number, extraAnnualOverhead = 0) {
  // Man-hours, not crew-hours: every productive person contributes capacity.
  // The owner/manager remains a productive worker when staff are added unless
  // the user explicitly marks them as office-only.
  const totalEmployees = d.crewCount * d.employeesPerCrew;
  const ownerIsProducing = d.ownerWorksInField !== false;
  const ownerProductiveWorkers = ownerIsProducing ? 1 : 0;
  const productiveWorkers = totalEmployees + ownerProductiveWorkers;
  const weeks = capacityWeeks(d, annualWorkingWeeks);
  const paidWeeks = payrollWeeks(d, weeks, annualWorkingWeeks);
  const weeklyBillableHours = resolvedWeeklyBillableHours(d);
  const manHoursPerProductiveWorker = weeks * weeklyBillableHours * (d.productionEfficiencyPct / 100);
  const manHoursYear = productiveWorkers * manHoursPerProductiveWorker;

  const wagePerWeek = totalEmployees * d.avgEmployeeHourlyRate * d.avgEmployeeHoursPerWeek;
  const employeeAnnualWages = wagePerWeek * weeks;
  const employeeLaborCost = employeeAnnualWages * (1 + d.payrollBurdenPct / 100);
  const offSeasonWages = wagePerWeek * Math.max(0, paidWeeks - weeks);
  const offSeasonPayrollOverhead = offSeasonWages * (1 + d.payrollBurdenPct / 100);
  const totalLaborCost = employeeLaborCost + d.ownerSalaryAnnual;

  const standardAnnual = OVERHEAD_CATEGORIES.reduce((s, { key }) => s + categoryAnnualAmount(d, key), 0);
  const customAnnual = customOverheadAnnual(d);
  const overheadLaborAnnual = divisionAllocatedLaborAnnual(d, annualWorkingWeeks);
  const salaryExpenseAnnual = salaryPayrollAnnual(d);
  const allocatedCompanyLabor = Number.isFinite(extraAnnualOverhead) && extraAnnualOverhead > 0 ? extraAnnualOverhead : 0;
  const monthlyOverhead = (standardAnnual + customAnnual + overheadLaborAnnual + allocatedCompanyLabor + salaryExpenseAnnual) / 12;
  const annualOverhead = standardAnnual + customAnnual + offSeasonPayrollOverhead + overheadLaborAnnual + allocatedCompanyLabor + salaryExpenseAnnual;
  const totalAnnualCosts = totalLaborCost + annualOverhead;

  const requiredRevenue = d.targetNetMarginPct >= 100 ? 0 :
    totalAnnualCosts / (1 - d.targetNetMarginPct / 100);
  const requiredHourlyRate = manHoursYear > 0 ? requiredRevenue / manHoursYear : 0;
  const breakEvenRate = manHoursYear > 0 ? totalAnnualCosts / manHoursYear : 0;
  const fixedAnnualCosts = d.ownerSalaryAnnual + annualOverhead;
  const fixedCostPerManHour = manHoursYear > 0 ? fixedAnnualCosts / manHoursYear : 0;
  const employeeCostPerManHour = manHoursYear > 0 ? employeeLaborCost / manHoursYear : 0;
  const ownerOnlyRequiredHourlyRate = manHoursPerProductiveWorker > 0 && d.targetNetMarginPct < 100
    ? fixedAnnualCosts / (1 - d.targetNetMarginPct / 100) / manHoursPerProductiveWorker
    : 0;
  const ownerOnlyBreakEvenRate = manHoursPerProductiveWorker > 0
    ? fixedAnnualCosts / manHoursPerProductiveWorker
    : 0;
  const staffingRateDifference = ownerIsProducing && totalEmployees > 0
    ? requiredHourlyRate - ownerOnlyRequiredHourlyRate
    : 0;
  const employeeBurdenedCostPerProductiveHour = manHoursPerProductiveWorker > 0
    ? (d.avgEmployeeHourlyRate * d.avgEmployeeHoursPerWeek * weeks *
      (1 + d.payrollBurdenPct / 100)) / manHoursPerProductiveWorker
    : 0;
  const netProfit = requiredRevenue - totalAnnualCosts;
  const minimumShowUpCost = requiredHourlyRate * d.minimumVisitHours;
  const jobFloorCalculated = calculatedJobFloor(d, { totalLaborCost, annualOverhead, manHoursYear });
  const jobFloorPrice = effectiveJobFloor(jobFloorCalculated, d.floorPriceOverride);

  // Pay-for-performance: employee earns whichever is greater — their
  // guaranteed base rate, or their cut of revenue-per-hour — never both.
  const p4pRevenueShare = requiredHourlyRate * (d.p4pPercentage / 100);
  const employeeTotalPayPerHour = Math.max(d.employeeBaseHourlyRate, p4pRevenueShare);
  const isP4PActive = p4pRevenueShare > d.employeeBaseHourlyRate;
  const companyLaborCostPerHour = employeeTotalPayPerHour * (1 + d.payrollBurdenPct / 100);

  // Material markup: overhead is allocated to materials only in proportion
  // to material cost's share of the total cost base — not the full overhead
  // burden, since labor/hourly billing already carries most of it.
  const materialsAnnual = materialCostAnnual(d);
  const totalCostBase = totalLaborCost + annualOverhead + materialsAnnual;
  const materialShareOfCosts = totalCostBase > 0 ? materialsAnnual / totalCostBase : 0;
  const overheadAllocatedToMaterials = annualOverhead * materialShareOfCosts;
  const requiredMaterialRevenue = (materialsAnnual > 0 && d.targetNetMarginPct < 100)
    ? (materialsAnnual + overheadAllocatedToMaterials) / (1 - d.targetNetMarginPct / 100)
    : 0;
  const recommendedMarkup = materialsAnnual > 0
    ? Math.round(((requiredMaterialRevenue - materialsAnnual) / materialsAnnual) * 100)
    : 0;

  return {
    manHoursYear: Math.round(manHoursYear),
    capacityWeeks: weeks,
    payrollWeeks: paidWeeks,
    weeklyBillableHours,
    annualBillableHours: Math.round(manHoursYear),
    totalEmployees,
    productiveWorkers,
    ownerIsProducing,
    ownerProductiveWorkers,
    manHoursPerProductiveWorker,
    employeeAnnualWages,
    employeeLaborCost,
    totalLaborCost,
    monthlyOverhead,
    customOverheadAnnual: customAnnual,
    overheadLaborAnnual,
    salaryExpenseAnnual,
    allocatedCompanyLabor,
    offSeasonPayrollOverhead,
    annualOverhead,
    totalAnnualCosts,
    requiredRevenue,
    requiredHourlyRate,
    breakEvenRate,
    fixedCostPerManHour,
    employeeCostPerManHour,
    ownerOnlyRequiredHourlyRate,
    ownerOnlyBreakEvenRate,
    staffingRateDifference,
    staffingRaisesRate: staffingRateDifference > 0.01,
    employeeBurdenedCostPerProductiveHour,
    netProfit,
    minimumShowUpCost,
    jobFloorCalculated,
    jobFloorPrice,
    employeeTotalPayPerHour,
    companyLaborCostPerHour,
    isP4PActive,
    overheadAllocatedToMaterials,
    recommendedMarkup: Math.max(0, recommendedMarkup),
  };
}

export type DivisionResults = ReturnType<typeof computeDivision>;

/** Company-wide hourly/salary labor split across divisions by productive man-hours. */
export function proportionalOverheadLaborShares(year: BudgetYear, annualWorkingWeeks?: number): Map<string, number> {
  const weeks = typeof annualWorkingWeeks === 'number' && annualWorkingWeeks > 0 ? annualWorkingWeeks : year.annualWorkingWeeks;
  const { proportional } = summarizeOverheadLabor(year, weeks);
  const hours = year.divisions.map(division => ({
    id: division.id,
    hours: Math.max(0, computeDivision(division, weeks).manHoursYear),
  }));
  const totalHours = hours.reduce((sum, row) => sum + row.hours, 0);
  const shares = new Map<string, number>();
  for (const row of hours) {
    shares.set(row.id, proportional > 0 && totalHours > 0 ? proportional * (row.hours / totalHours) : 0);
  }
  return shares;
}

// ── Company-wide rollup across every division ───────────────────────────────
export function computeCompanyTotal(year: BudgetYear) {
  const annualWorkingWeeks = typeof year.annualWorkingWeeks === 'number' && year.annualWorkingWeeks > 0 ? year.annualWorkingWeeks : undefined;
  const shares = proportionalOverheadLaborShares(year, annualWorkingWeeks);
  const labor = summarizeOverheadLabor(year, annualWorkingWeeks);
  const rows = year.divisions.map(division => ({
    division,
    results: computeDivision(division, annualWorkingWeeks, shares.get(division.id) ?? 0),
  }));

  const combinedManHours = rows.reduce((s, r) => s + r.results.manHoursYear, 0);
  const combinedTotalEmployees = rows.reduce((s, r) => s + r.results.totalEmployees, 0);
  const combinedProductiveWorkers = rows.reduce((s, r) => s + r.results.productiveWorkers, 0);
  const combinedLaborCost = rows.reduce((s, r) => s + r.results.totalLaborCost, 0);
  const divisionMaterialCost = year.divisions.reduce((s, d) => s + materialCostAnnual(d), 0);
  const companyMaterialCost = companyCogsAnnual(year);
  const combinedMaterialCost = divisionMaterialCost + companyMaterialCost;
  const divisionSalaryExpense = rows.reduce((s, r) => s + r.results.salaryExpenseAnnual, 0);
  const companySalaryExpense = companySalaryAnnual(year);
  // Roles, division salary lines, and company salary are each added once.
  // Company salary is not inside a division's annual overhead.
  const salaryPayrollAnnualTotal = labor.total + divisionSalaryExpense + companySalaryExpense;

  const customAnnual = rows.reduce((s, r) => s + r.results.customOverheadAnnual, 0);
  const offSeasonAnnual = rows.reduce((s, r) => s + r.results.offSeasonPayrollOverhead, 0);
  const overheadByCategory = [
    ...OVERHEAD_CATEGORIES.map(({ key, label }) => {
      const auto = year.divisions.reduce((s, d) => s + categoryAnnualAmount(d, key), 0)
        + (key === 'miscOverhead' ? customAnnual + offSeasonAnnual : 0);
      return { key: key as string, label, auto, override: undefined as number | undefined, effective: auto };
    }),
    {
      key: 'overheadLabor',
      label: 'Salary / Payroll',
      auto: salaryPayrollAnnualTotal,
      override: undefined as number | undefined,
      effective: salaryPayrollAnnualTotal,
    },
  ];
  const combinedAnnualOverhead = overheadByCategory.reduce((s, o) => s + o.effective, 0);
  const combinedTotalAnnualCosts = combinedLaborCost + combinedAnnualOverhead;

  // Blend each division's own target margin, weighted by its share of costs,
  // so the combined rate reflects a realistic company-wide margin goal.
  const preOverrideCosts = rows.reduce((s, r) => s + r.results.totalAnnualCosts, 0);
  const blendedMarginPct = preOverrideCosts > 0
    ? rows.reduce((s, r) => s + r.division.targetNetMarginPct * r.results.totalAnnualCosts, 0) / preOverrideCosts
    : 0;

  const combinedRequiredRevenue = blendedMarginPct >= 100 ? 0 :
    combinedTotalAnnualCosts / (1 - blendedMarginPct / 100);
  const combinedRequiredHourlyRate = combinedManHours > 0 ? combinedRequiredRevenue / combinedManHours : 0;
  const combinedBreakEvenRate = combinedManHours > 0 ? combinedTotalAnnualCosts / combinedManHours : 0;
  const combinedNetProfit = combinedRequiredRevenue - combinedTotalAnnualCosts;
  const combinedMinimumVisitHours = rows.length > 0
    ? rows.reduce((s, r) => s + r.division.minimumVisitHours, 0) / rows.length
    : 1;
  const combinedMinimumShowUpCost = combinedRequiredHourlyRate * combinedMinimumVisitHours;
  const companyJobFloorCalculated = combinedManHours > 0
    ? ((combinedLaborCost + combinedAnnualOverhead + combinedMaterialCost) / combinedManHours) * combinedMinimumVisitHours
    : 0;
  const companyJobFloorPrice = effectiveJobFloor(companyJobFloorCalculated, year.companyFloorPriceOverride);
  const monthlyOverheadExpense = combinedAnnualOverhead / 12;

  return {
    rows,
    combinedManHours,
    combinedTotalEmployees,
    combinedProductiveWorkers,
    combinedLaborCost,
    combinedMaterialCost,
    overheadByCategory,
    combinedAnnualOverhead,
    combinedTotalAnnualCosts,
    blendedMarginPct,
    combinedRequiredRevenue,
    combinedRequiredHourlyRate,
    combinedBreakEvenRate,
    combinedNetProfit,
    combinedMinimumShowUpCost,
    annualWorkingWeeks: annualWorkingWeeks ?? 0,
    monthlyOverheadExpense,
    companyJobFloorCalculated,
    companyJobFloorPrice,
    overheadLaborAnnual: labor.total,
    overheadLaborMonthly: labor.total / 12,
    overheadLaborLines: listOverheadLabor(year, annualWorkingWeeks),
    salaryPayrollAnnual: salaryPayrollAnnualTotal,
    salaryPayrollMonthly: salaryPayrollAnnualTotal / 12,
    divisionMaterialCost,
    companyMaterialCost,
    divisionSalaryExpense,
    companySalaryExpense,
  };
}

// ── Checkup comparison helpers ───────────────────────────────────────────────
export interface CheckupLineComparison {
  key: string;
  label: string;
  budgeted: number;
  actual: number;
  varianceAbs: number;
  variancePct: number;
}

export function compareCheckup(
  checkup: CheckupData,
  budgetedTotals: { revenue: number; laborCost: number; materialCost: number; overheadByCategory: { key: string; label: string; annual: number }[] },
): { totals: CheckupLineComparison[]; overheadLines: CheckupLineComparison[] } {
  const line = (key: string, label: string, budgeted: number, actual: number): CheckupLineComparison => {
    const varianceAbs = actual - budgeted;
    const variancePct = budgeted !== 0 ? (varianceAbs / budgeted) * 100 : (actual !== 0 ? 100 : 0);
    return { key, label, budgeted, actual, varianceAbs, variancePct };
  };

  const totals: CheckupLineComparison[] = [
    line('revenue', 'Revenue', budgetedTotals.revenue, checkup.actualRevenue),
    line('laborCost', 'Labor Cost', budgetedTotals.laborCost, checkup.actualLaborCost),
    line('materialCost', 'Material Cost', budgetedTotals.materialCost, checkup.actualMaterialCost),
    line(
      'overhead',
      'Overhead (total)',
      budgetedTotals.overheadByCategory.reduce((s, o) => s + o.annual, 0),
      OVERHEAD_CATEGORIES.reduce((s, { key }) => s + (Number(checkup.actualOverhead[key]) || 0), 0),
    ),
  ];

  const overheadLines: CheckupLineComparison[] = budgetedTotals.overheadByCategory.map(o =>
    line(o.key, o.label, o.annual, Number(checkup.actualOverhead[o.key as keyof OverheadLineItems]) || 0),
  );

  return { totals, overheadLines };
}
