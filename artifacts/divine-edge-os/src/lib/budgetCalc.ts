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
  crewCount: number;
  workWeeksPerYear: number;
  workDaysPerWeek: number;
  billableHoursPerDay: number;
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
  estimatedAnnualMaterialCost: number;
  minimumVisitHours: number;
  midYearCheckup: CheckupData;
  endYearCheckup: CheckupData;
}

export function defaultDivision(name = 'Main'): DivisionBudget {
  return {
    id: crypto.randomUUID(),
    name,
    crewCount: 2,
    workWeeksPerYear: 32,
    workDaysPerWeek: 5,
    billableHoursPerDay: 8,
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
    minimumVisitHours: 1,
    midYearCheckup: defaultCheckup(),
    endYearCheckup: defaultCheckup(),
  };
}

// Migrates a single legacy "flat" budget object (pre-divisions) into a division.
function migrateFlatToDivision(raw: any, name = 'Main'): DivisionBudget {
  const base = defaultDivision(name);
  const merged: DivisionBudget = { ...base, ...raw, id: raw.id ?? base.id, name: raw.name ?? name };
  merged.midYearCheckup = migrateCheckup(raw.midYearCheckup);
  merged.endYearCheckup = migrateCheckup(raw.endYearCheckup);
  merged.estimatedAnnualMaterialCost = Number(raw.estimatedAnnualMaterialCost) || 0;
  merged.minimumVisitHours = Number(raw.minimumVisitHours) || 1;
  return merged;
}

// ── Budget year (all divisions + company-level rollup adjustments) ─────────
export interface BudgetYear {
  year: number;
  divisions: DivisionBudget[];
  overheadOverrides: Partial<OverheadLineItems>;
  companyMidYearCheckup: CheckupData;
  companyEndYearCheckup: CheckupData;
  savedAt?: string;
}

export function defaultBudgetYear(year = new Date().getFullYear()): BudgetYear {
  return {
    year,
    divisions: [defaultDivision('Main')],
    overheadOverrides: {},
    companyMidYearCheckup: defaultCheckup(),
    companyEndYearCheckup: defaultCheckup(),
  };
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
        companyMidYearCheckup: migrateCheckup(raw.companyMidYearCheckup),
        companyEndYearCheckup: migrateCheckup(raw.companyEndYearCheckup),
        savedAt: raw.savedAt,
      };
    }
    // Legacy flat shape: the whole object IS a single division's fields.
    return {
      year: raw?.year ?? new Date().getFullYear(),
      divisions: [migrateFlatToDivision(raw ?? {}, 'Main')],
      overheadOverrides: {},
      companyMidYearCheckup: defaultCheckup(),
      companyEndYearCheckup: defaultCheckup(),
      savedAt: raw?.savedAt,
    };
  });
}

// ── Division-level computed results ─────────────────────────────────────────
export function computeDivision(d: DivisionBudget) {
  // Man-hours, not crew-hours: every productive person contributes capacity.
  // The owner/manager remains a productive worker when staff are added unless
  // the user explicitly marks them as office-only.
  const totalEmployees = d.crewCount * d.employeesPerCrew;
  const ownerIsProducing = d.ownerWorksInField !== false;
  const ownerProductiveWorkers = ownerIsProducing ? 1 : 0;
  const productiveWorkers = totalEmployees + ownerProductiveWorkers;
  const manHoursPerProductiveWorker =
    d.workWeeksPerYear * d.workDaysPerWeek * d.billableHoursPerDay *
    (d.productionEfficiencyPct / 100);
  const manHoursYear = productiveWorkers * manHoursPerProductiveWorker;

  const employeeAnnualWages =
    totalEmployees * d.avgEmployeeHourlyRate * d.avgEmployeeHoursPerWeek * d.workWeeksPerYear;
  const employeeLaborCost = employeeAnnualWages * (1 + d.payrollBurdenPct / 100);
  const totalLaborCost = employeeLaborCost + d.ownerSalaryAnnual;

  const monthlyOverhead = OVERHEAD_CATEGORIES.reduce((s, { key }) => s + (Number(d[key]) || 0), 0);
  const annualOverhead = monthlyOverhead * 12;
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
    ? (d.avgEmployeeHourlyRate * d.avgEmployeeHoursPerWeek * d.workWeeksPerYear *
      (1 + d.payrollBurdenPct / 100)) / manHoursPerProductiveWorker
    : 0;
  const netProfit = requiredRevenue - totalAnnualCosts;
  const minimumShowUpCost = requiredHourlyRate * d.minimumVisitHours;

  // Pay-for-performance: employee earns whichever is greater — their
  // guaranteed base rate, or their cut of revenue-per-hour — never both.
  const p4pRevenueShare = requiredHourlyRate * (d.p4pPercentage / 100);
  const employeeTotalPayPerHour = Math.max(d.employeeBaseHourlyRate, p4pRevenueShare);
  const isP4PActive = p4pRevenueShare > d.employeeBaseHourlyRate;
  const companyLaborCostPerHour = employeeTotalPayPerHour * (1 + d.payrollBurdenPct / 100);

  // Material markup: overhead is allocated to materials only in proportion
  // to material cost's share of the total cost base — not the full overhead
  // burden, since labor/hourly billing already carries most of it.
  const totalCostBase = totalLaborCost + annualOverhead + d.estimatedAnnualMaterialCost;
  const materialShareOfCosts = totalCostBase > 0 ? d.estimatedAnnualMaterialCost / totalCostBase : 0;
  const overheadAllocatedToMaterials = annualOverhead * materialShareOfCosts;
  const requiredMaterialRevenue = (d.estimatedAnnualMaterialCost > 0 && d.targetNetMarginPct < 100)
    ? (d.estimatedAnnualMaterialCost + overheadAllocatedToMaterials) / (1 - d.targetNetMarginPct / 100)
    : 0;
  const recommendedMarkup = d.estimatedAnnualMaterialCost > 0
    ? Math.round(((requiredMaterialRevenue - d.estimatedAnnualMaterialCost) / d.estimatedAnnualMaterialCost) * 100)
    : 0;

  return {
    manHoursYear: Math.round(manHoursYear),
    totalEmployees,
    productiveWorkers,
    ownerIsProducing,
    ownerProductiveWorkers,
    manHoursPerProductiveWorker,
    employeeAnnualWages,
    employeeLaborCost,
    totalLaborCost,
    monthlyOverhead,
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
    employeeTotalPayPerHour,
    companyLaborCostPerHour,
    isP4PActive,
    overheadAllocatedToMaterials,
    recommendedMarkup: Math.max(0, recommendedMarkup),
  };
}

export type DivisionResults = ReturnType<typeof computeDivision>;

// ── Company-wide rollup across every division ───────────────────────────────
export function computeCompanyTotal(year: BudgetYear) {
  const rows = year.divisions.map(division => ({ division, results: computeDivision(division) }));

  const combinedManHours = rows.reduce((s, r) => s + r.results.manHoursYear, 0);
  const combinedTotalEmployees = rows.reduce((s, r) => s + r.results.totalEmployees, 0);
  const combinedProductiveWorkers = rows.reduce((s, r) => s + r.results.productiveWorkers, 0);
  const combinedLaborCost = rows.reduce((s, r) => s + r.results.totalLaborCost, 0);
  const combinedMaterialCost = year.divisions.reduce((s, d) => s + d.estimatedAnnualMaterialCost, 0);

  const overheadByCategory = OVERHEAD_CATEGORIES.map(({ key, label }) => {
    const auto = year.divisions.reduce((s, d) => s + (Number(d[key]) || 0), 0) * 12;
    const override = year.overheadOverrides[key];
    const effective = override !== undefined ? override : auto;
    return { key, label, auto, override, effective };
  });
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
  budgetedTotals: { revenue: number; laborCost: number; materialCost: number; overheadByCategory: { key: keyof OverheadLineItems; label: string; annual: number }[] },
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
    line(o.key, o.label, o.annual, Number(checkup.actualOverhead[o.key]) || 0),
  );

  return { totals, overheadLines };
}
