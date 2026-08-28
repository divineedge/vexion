import { describe, expect, it } from "vitest";
import {
  OVERHEAD_CATEGORIES,
  computeDivision,
  computeCompanyTotal,
  defaultBudgetYear,
  defaultDivision,
  type DivisionBudget,
} from "../src/lib/budgetCalc";

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
      divisions: [oneEmployee, twoEmployees],
    };

    const result = computeCompanyTotal(year);

    expect(result.combinedProductiveWorkers).toBe(5);
    expect(result.combinedManHours).toBe(10_000);
    expect(result.combinedTotalAnnualCosts).toBe(350_000);
    expect(result.combinedRequiredHourlyRate).toBe(35);
  });
});