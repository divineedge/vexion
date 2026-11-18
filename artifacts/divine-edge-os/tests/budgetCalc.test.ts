import { describe, expect, it } from "vitest";
import {
  OVERHEAD_CATEGORIES,
  computeDivision,
  computeCompanyTotal,
  defaultBudgetYear,
  defaultDivision,
  annualizedExpense,
  monthlyExpense,
  clampAnnualWorkingWeeks,
  migrateBudgetPayload,
  overheadLaborAnnualCost,
  newOverheadLaborRole,
  carryForwardBudgetYear,
  resolveBudgetYear,
  companyOverheadShare,
  companyCategoryOverheadAnnual,
  type DivisionBudget,
  type OverheadLaborRole,
} from "../src/lib/budgetCalc";
import { companyFloorBaseline, divisionFloorBaseline } from "../src/lib/jobPricingFloorBaseline";

function budgetWithWorkers(employeeCount: number, payrollBurdenPct = 0): DivisionBudget {
  const division = defaultDivision("Man-hour test");
  for (const { key } of OVERHEAD_CATEGORIES) division[key] = 0;
  return {
    ...division,
    crewCount: 1,
    employeesPerCrew: employeeCount,
    ownerWorksInField: true,
    ownerSalaryAnnual: 100_000,
    avgEmployeeHourlyRate: 25,
    avgEmployeeHoursPerWeek: 40,
    payrollBurdenPct,
    workWeeksPerYear: 50,
    workDaysPerWeek: 5,
    billableHoursPerDay: 8,
    productionEfficiencyPct: 100,
    targetNetMarginPct: 0,
  };
}

describe("budget man-hour rate", () => {
  it("counts the productive manager when no field employees exist", () => {
    const result = computeDivision(budgetWithWorkers(0));

    expect(result.productiveWorkers).toBe(1);
    expect(result.manHoursYear).toBe(2_000);
    expect(result.requiredHourlyRate).toBe(50);
  });

  it("spreads manager and employee costs over both workers' man-hours", () => {
    const result = computeDivision(budgetWithWorkers(1));

    expect(result.productiveWorkers).toBe(2);
    expect(result.manHoursYear).toBe(4_000);
    expect(result.totalAnnualCosts).toBe(150_000);
    expect(result.requiredHourlyRate).toBe(37.5);
  });

  it("spreads costs over manager plus two employees", () => {
    const result = computeDivision(budgetWithWorkers(2));

    expect(result.productiveWorkers).toBe(3);
    expect(result.manHoursYear).toBe(6_000);
    expect(result.totalAnnualCosts).toBe(200_000);
    expect(result.requiredHourlyRate).toBeCloseTo(33.3333, 4);
  });

  it("includes payroll burden without dropping the manager's capacity", () => {
    const result = computeDivision(budgetWithWorkers(1, 20));

    expect(result.employeeLaborCost).toBe(60_000);
    expect(result.manHoursYear).toBe(4_000);
    expect(result.requiredHourlyRate).toBe(40);
  });

  it("does not count the manager when explicitly marked office-only", () => {
    const division = budgetWithWorkers(1);
    division.ownerWorksInField = false;

    const result = computeDivision(division);

    expect(result.productiveWorkers).toBe(1);
    expect(result.manHoursYear).toBe(2_000);
    expect(result.requiredHourlyRate).toBe(75);
  });

  it("rolls multiple divisions up using all productive man-hours", () => {
    const oneEmployee = budgetWithWorkers(1);
    const twoEmployees = budgetWithWorkers(2);
    const year = {
      ...defaultBudgetYear(2026),
      annualWorkingWeeks: 50,
      divisions: [oneEmployee, twoEmployees],
    };

    const result = computeCompanyTotal(year);

    expect(result.combinedProductiveWorkers).toBe(5);
    expect(result.combinedManHours).toBe(10_000);
    expect(result.combinedTotalAnnualCosts).toBe(350_000);
    expect(result.combinedRequiredHourlyRate).toBe(35);
    expect(result.monthlyOverheadExpense).toBe(result.combinedAnnualOverhead / 12);
  });

  it("prices seasonal labor on weeks worked and parks year-round off-season pay in overhead", () => {
    const division = budgetWithWorkers(1);
    division.technicianSchedule = "seasonal";
    division.weeksWorkedPerYear = 32;
    division.yearRoundPay = true;
    division.weeklyBillableHours = 35;
    const result = computeDivision(division, 48);
    expect(result.capacityWeeks).toBe(32);
    expect(result.payrollWeeks).toBe(48);
    expect(result.annualBillableHours).toBe(Math.round(2 * 35 * 32));
    expect(result.employeeLaborCost).toBe(25 * 40 * 32 * 1);
    expect(result.offSeasonPayrollOverhead).toBe(25 * 40 * 16);
  });

  it("rolls custom division overhead into company miscellaneous", () => {
    const division = budgetWithWorkers(0);
    division.customOverhead = [{ id: "storage", name: "Storage yard", monthlyAmount: 100 }];
    const year = { ...defaultBudgetYear(2026), annualWorkingWeeks: 50, divisions: [division] };
    const result = computeCompanyTotal(year);
    const misc = result.overheadByCategory.find(line => line.key === "miscOverhead");
    expect(misc?.effective).toBe(1200);
    expect(result.monthlyOverheadExpense).toBe(100);
  });
});

describe("expense frequency", () => {
  it("annualizes a monthly amount and leaves an annual amount unchanged", () => {
    expect(annualizedExpense(100, "monthly")).toBe(1_200);
    expect(monthlyExpense(100, "monthly")).toBe(100);
    expect(annualizedExpense(1_200, "annual")).toBe(1_200);
    expect(monthlyExpense(1_200, "annual")).toBe(100);
  });

  it("treats a division line with no frequency as monthly", () => {
    const division = budgetWithWorkers(0);
    division.fuelMaintenance = 100;
    const result = computeDivision(division);
    expect(result.annualOverhead).toBe(1_200);
    expect(result.monthlyOverhead).toBe(100);
    division.overheadFrequency = { fuelMaintenance: "annual" };
    const annual = computeDivision(division);
    expect(annual.annualOverhead).toBe(100);
    expect(annual.monthlyOverhead).toBeCloseTo(100 / 12, 5);
    expect(annual.breakEvenRate).toBeCloseTo(annual.totalAnnualCosts / annual.manHoursYear, 5);
  });

  it("rolls an annual line into the company total without multiplying it by 12", () => {
    const division = budgetWithWorkers(0);
    division.generalLiabilityInsurance = 3600;
    division.overheadFrequency = { generalLiabilityInsurance: "annual" };
    const totals = computeCompanyTotal({ ...defaultBudgetYear(2026), divisions: [division] });
    const insurance = totals.overheadByCategory.find(row => row.key === "generalLiabilityInsurance");
    expect(insurance?.effective).toBe(3600);
    expect(totals.monthlyOverheadExpense).toBeCloseTo(totals.combinedAnnualOverhead / 12, 5);
    expect(computeDivision(division).monthlyOverhead).toBeCloseTo(300, 5);
  });

  it("adds custom lines using each line's frequency", () => {
    const division = budgetWithWorkers(0);
    division.customOverhead = [
      { id: "m", name: "Shop", monthlyAmount: 50, amount: 50, frequency: "monthly" },
      { id: "a", name: "License", monthlyAmount: 50, amount: 600, frequency: "annual" },
    ];
    expect(computeDivision(division).annualOverhead).toBe(1_200);
    const year = { ...defaultBudgetYear(2026), divisions: [division] };
    expect(computeCompanyTotal(year).combinedAnnualOverhead).toBe(1_200);
    expect(computeCompanyTotal(year).monthlyOverheadExpense).toBe(100);
  });

  it("defaults saved lines and weeks when the frequency key is missing", () => {
    const [year] = migrateBudgetPayload({
      year: 2026,
      divisions: [{ name: "Main", fuelMaintenance: 10, customOverhead: [{ id: "yard", name: "Yard", monthlyAmount: 25 }] }],
    });
    expect(year.annualWorkingWeeks).toBe(48);
    expect(year.divisions[0].overheadFrequency).toEqual({});
    expect(year.divisions[0].fuelMaintenance).toBe(10);
    expect(year.divisions[0].customOverhead[0].frequency).toBe("monthly");
    expect(year.divisions[0].customOverhead[0].monthlyAmount).toBe(25);
    expect(year.divisions[0].overheadLabor).toEqual([]);
    expect(clampAnnualWorkingWeeks("", 40)).toBe(40);
    expect(clampAnnualWorkingWeeks("40", 48)).toBe(40);
    expect(clampAnnualWorkingWeeks("0", 48)).toBe(1);
    expect(clampAnnualWorkingWeeks("99", 48)).toBe(52);
  });
});

function salaried(over: Partial<OverheadLaborRole> = {}): OverheadLaborRole {
  return { ...newOverheadLaborRole("Office Manager"), annualAmount: 60_000, ...over, id: over.id ?? "office" };
}

describe("overhead and salaried labor", () => {
  it("adds a burdened annual salary to division overhead, break-even, and the job floor", () => {
    const division = budgetWithWorkers(0);
    division.overheadLabor = [salaried({ annualAmount: 12_000, inheritBurden: true })];
    const result = computeDivision(division);
    expect(overheadLaborAnnualCost(division.overheadLabor[0], 50, 0)).toBe(12_000);
    expect(result.overheadLaborAnnual).toBe(12_000);
    expect(result.annualOverhead).toBe(12_000);
    expect(result.monthlyOverhead).toBe(1_000);
    expect(result.totalAnnualCosts).toBe(112_000);
    expect(result.breakEvenRate).toBe(56);
    expect(result.requiredHourlyRate).toBe(56);
    expect(result.jobFloorCalculated).toBe(56);
    expect(divisionFloorBaseline(division).monthlyOverhead).toBeCloseTo(result.monthlyOverhead + 100_000 / 12, 2);
  });

  it("annualizes hourly overhead as rate × hours/week × working weeks and can use its own burden", () => {
    const division = budgetWithWorkers(0);
    division.payrollBurdenPct = 22;
    division.overheadLabor = [salaried({
      payType: "hourly", hourlyRate: 20, hoursPerWeek: 10, annualAmount: 0,
      inheritBurden: false, payrollBurdenPct: 10,
    })];
    const result = computeDivision(division, 48);
    expect(result.overheadLaborAnnual).toBe(20 * 10 * 48 * 1.1);
    expect(result.monthlyOverhead).toBeCloseTo(result.overheadLaborAnnual / 12, 5);
    expect(result.breakEvenRate).toBeCloseTo(result.totalAnnualCosts / result.manHoursYear, 5);
  });

  it("inherits the division payroll burden when the role does not set its own", () => {
    const division = budgetWithWorkers(0, 25);
    division.overheadLabor = [salaried({ annualAmount: 40_000, inheritBurden: true, payrollBurdenPct: 0 })];
    expect(computeDivision(division).overheadLaborAnnual).toBe(50_000);
  });

  it("keeps company-total labor out of the division rate and inside the company overhead and floor", () => {
    const division = budgetWithWorkers(0);
    division.overheadLabor = [salaried({ annualAmount: 12_000, allocation: "company_total" })];
    const alone = computeDivision(division, 50);
    expect(alone.overheadLaborAnnual).toBe(0);
    expect(alone.annualOverhead).toBe(0);
    expect(alone.breakEvenRate).toBe(50);
    const year = { ...defaultBudgetYear(2026), annualWorkingWeeks: 50, divisions: [division] };
    const totals = computeCompanyTotal(year);
    expect(totals.overheadLaborAnnual).toBe(12_000);
    expect(totals.overheadLaborMonthly).toBe(1_000);
    expect(totals.combinedAnnualOverhead).toBe(12_000);
    expect(totals.monthlyOverheadExpense).toBe(1_000);
    expect(totals.combinedBreakEvenRate).toBe(112_000 / 2_000);
    expect(totals.companyJobFloorCalculated).toBeCloseTo(112_000 / 2_000, 5);
    const without = companyFloorBaseline({ ...year, divisions: [{ ...division, overheadLabor: [] }] });
    expect(companyFloorBaseline(year).monthlyOverhead - without.monthlyOverhead).toBeCloseTo(1_000, 2);
  });

  it("splits company-wide labor across divisions in proportion to productive hours", () => {
    const lawn = budgetWithWorkers(0);
    lawn.id = "lawn";
    lawn.overheadLabor = [salaried({ annualAmount: 10_000, allocation: "company_proportional" })];
    const snow = budgetWithWorkers(1);
    snow.id = "snow";
    snow.ownerSalaryAnnual = 0;
    const year = { ...defaultBudgetYear(2026), annualWorkingWeeks: 50, divisions: [lawn, snow] };
    const totals = computeCompanyTotal(year);
    const lawnHours = totals.rows[0].results.manHoursYear;
    const snowHours = totals.rows[1].results.manHoursYear;
    expect(lawnHours).toBe(2_000);
    expect(snowHours).toBe(4_000);
    expect(totals.rows[0].results.allocatedCompanyLabor).toBeCloseTo(10_000 * 2_000 / 6_000, 5);
    expect(totals.rows[1].results.allocatedCompanyLabor).toBeCloseTo(10_000 * 4_000 / 6_000, 5);
    expect(totals.rows[0].results.overheadLaborAnnual).toBe(0);
    expect(totals.overheadLaborAnnual).toBe(10_000);
    expect(totals.combinedAnnualOverhead).toBe(10_000);
    expect(totals.monthlyOverheadExpense).toBeCloseTo(10_000 / 12, 5);
    expect(totals.combinedTotalAnnualCosts).toBe(100_000 + 50_000 + 10_000);
    const floor = divisionFloorBaseline(lawn, 50, totals.rows[0].results.allocatedCompanyLabor);
    expect(floor.monthlyOverhead).toBeCloseTo(totals.rows[0].results.monthlyOverhead + 100_000 / 12, 2);
  });

  it("drops unnamed roles on reload and keeps a saved salary", () => {
    const [year] = migrateBudgetPayload({
      year: 2026,
      divisions: [{
        name: "Main",
        overheadLabor: [
          { id: "ok", name: "Shop Mechanic", payType: "annual_salary", annualAmount: 30_000, inheritBurden: false, payrollBurdenPct: 10, allocation: "division" },
          { name: "   " },
        ],
      }],
    });
    expect(year.divisions[0].overheadLabor).toHaveLength(1);
    expect(year.divisions[0].overheadLabor?.[0].name).toBe("Shop Mechanic");
    expect(computeDivision(year.divisions[0], 48).overheadLaborAnnual).toBe(33_000);
  });
});

describe("budget year carry-forward", () => {
  it("keeps divisions and checkup numbers the first time a later year is opened", () => {
    const prior = defaultBudgetYear(2026);
    prior.savedAt = "2026-06-01T00:00:00.000Z";
    prior.companyTotalRevenue = 120_000;
    prior.companyOverhead = { fuelMaintenance: 1_000, vehiclePayments: 500 };
    prior.companyOverheadFrequency = { fuelMaintenance: "annual", vehiclePayments: "monthly" };
    prior.divisions = [
      { ...defaultDivision("Lawn"), id: "lawn", income: 60_000, revenue: 70_000, fuelMaintenance: 100 },
      { ...defaultDivision("Snow"), id: "snow", income: 40_000, revenue: 50_000, vehiclePayments: 80 },
    ];

    const opened = resolveBudgetYear([prior], 2027);

    expect(opened.year).toBe(2027);
    expect(opened.savedAt).toBeUndefined();
    expect(opened.divisions.map(division => division.name)).toEqual(["Lawn", "Snow"]);
    expect(opened.divisions.map(division => division.id)).toEqual(["lawn", "snow"]);
    expect(opened.divisions[0].fuelMaintenance).toBe(100);
    expect(opened.divisions[0].revenue).toBe(70_000);
    expect(opened.divisions[1].income).toBe(40_000);
    expect(opened.companyTotalRevenue).toBe(120_000);
    expect(opened.companyOverhead?.vehiclePayments).toBe(500);
    expect(opened.divisions[0]).not.toBe(prior.divisions[0]);
    opened.divisions[0].fuelMaintenance = 1;
    expect(prior.divisions[0].fuelMaintenance).toBe(100);
  });

  it("does not copy again once that year has been stored", () => {
    const prior = defaultBudgetYear(2026);
    prior.divisions = [
      { ...defaultDivision("Lawn"), id: "lawn", revenue: 70_000, income: 60_000, fuelMaintenance: 100 },
      { ...defaultDivision("Snow"), id: "snow", revenue: 50_000, income: 40_000 },
    ];
    const first = carryForwardBudgetYear(prior, 2027);
    const saved = {
      ...first,
      savedAt: "2027-01-02T00:00:00.000Z",
      companyTotalRevenue: 90_000,
      divisions: first.divisions.map(division => division.id === "lawn" ? { ...division, fuelMaintenance: 250, revenue: 80_000 } : division),
    };
    const changedPrior = {
      ...prior,
      companyTotalRevenue: 10,
      divisions: prior.divisions.map(division => ({ ...division, fuelMaintenance: 1, revenue: 1, income: 1 })),
    };

    const again = resolveBudgetYear([changedPrior, saved], 2027);

    expect(again).toBe(saved);
    expect(again.divisions.find(division => division.id === "lawn")?.fuelMaintenance).toBe(250);
    expect(again.divisions.find(division => division.id === "lawn")?.revenue).toBe(80_000);
    expect(again.companyTotalRevenue).toBe(90_000);
    expect(again.divisions.map(division => division.name)).toEqual(["Lawn", "Snow"]);
  });

  it("splits company overhead by division income and skips a zero total", () => {
    expect(companyOverheadShare(60_000, [60_000, 40_000], 1_000)).toBe(600);
    expect(companyOverheadShare(0, [0, 50_000], 1_000)).toBe(0);
    expect(companyOverheadShare(10, [0, 0], 1_000)).toBeNull();
    const year = defaultBudgetYear(2026);
    year.companyOverhead = { fuelMaintenance: 100 };
    year.companyOverheadFrequency = { fuelMaintenance: "monthly" };
    expect(companyCategoryOverheadAnnual(year, "fuelMaintenance")).toBe(1_200);
    expect(companyOverheadShare(25, [25, 75], companyCategoryOverheadAnnual(year, "fuelMaintenance"))).toBe(300);
  });

  it("reloads company revenue, division income, and company overhead", () => {
    const [year] = migrateBudgetPayload({
      year: 2026,
      companyTotalRevenue: 150_000,
      companyOverhead: { fuelMaintenance: 40, marketingAdvertising: -5 },
      companyOverheadFrequency: { fuelMaintenance: "annual" },
      divisions: [
        { id: "lawn", name: "Lawn", revenue: 80_000, income: 70_000 },
        { id: "snow", name: "Snow", revenue: 20_000, income: 15_000 },
      ],
    });
    expect(year.companyTotalRevenue).toBe(150_000);
    expect(year.companyOverhead?.fuelMaintenance).toBe(40);
    expect(year.companyOverhead?.marketingAdvertising).toBeUndefined();
    expect(year.companyOverheadFrequency?.fuelMaintenance).toBe("annual");
    expect(year.divisions.map(division => [division.revenue, division.income])).toEqual([[80_000, 70_000], [20_000, 15_000]]);
  });
});