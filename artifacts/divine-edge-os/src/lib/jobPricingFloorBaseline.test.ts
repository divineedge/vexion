import { describe, expect, it } from "vitest";
import { defaultBudgetYear, defaultDivision, migrateBudgetPayload, computeDivision, type BudgetYear, type DivisionBudget } from "./budgetCalc";
import { calculateJobPricingFloor } from "./jobPricingFloor";
import { divisionFloorBaseline, companyFloorBaseline, divisionCrewHoursYear } from "./jobPricingFloorBaseline";

const div = (name: string, over: Partial<DivisionBudget>): DivisionBudget => ({ ...defaultDivision(name), ...over });
const yearOf = (divisions: DivisionBudget[], extra: Partial<BudgetYear> = {}): BudgetYear => ({ ...defaultBudgetYear(2026), divisions, ...extra });

describe("job pricing floor baselines", () => {
  it("derives separate division baselines from each division's own budget (crew-hours)", () => {
    const a = div("Lawn", { crewCount: 2, workWeeksPerYear: 40, workDaysPerWeek: 5, billableHoursPerDay: 6, productionEfficiencyPct: 100, employeesPerCrew: 3, avgEmployeeHourlyRate: 20, payrollBurdenPct: 20, targetNetMarginPct: 15 });
    const b = div("Snow", { crewCount: 1, workWeeksPerYear: 12, workDaysPerWeek: 6, billableHoursPerDay: 8, productionEfficiencyPct: 50, employeesPerCrew: 1, avgEmployeeHourlyRate: 30, payrollBurdenPct: 10, targetNetMarginPct: 30 });
    const ba = divisionFloorBaseline(a), bb = divisionFloorBaseline(b);
    expect(ba.monthlyBillableHours).toBe(200); // 2*40*5*6/12 crew hrs, not x3 man-hours
    expect(bb.monthlyBillableHours).toBe(24);
    expect([ba.hourlyWage, ba.crewMembers, ba.targetMarginPct]).toEqual([20, 3, 15]);
    expect([bb.hourlyWage, bb.crewMembers, bb.targetMarginPct]).toEqual([30, 1, 30]);
  });

  it("counts owner salary once: in overhead, never as crew labor", () => {
    const d = div("Solo", { employeesPerCrew: 0, ownerSalaryAnnual: 60000, ownerWorksInField: true });
    const b = divisionFloorBaseline(d);
    expect(b.hourlyWage).toBe(0);
    expect(b.crewMembers).toBe(1);
    expect(b.monthlyOverhead).toBeCloseTo(computeDivision(d).monthlyOverhead + 5000, 2);
  });

  it("company overhead honours shared-cost overrides plus owner salaries once", () => {
    const a = div("A", { ownerSalaryAnnual: 12000, generalLiabilityInsurance: 300 }), b = div("B", { ownerSalaryAnnual: 24000, generalLiabilityInsurance: 300 });
    const auto = companyFloorBaseline(yearOf([a, b]));
    const ins = 300 * 12 * 2; // same policy entered on both divisions
    const overridden = companyFloorBaseline(yearOf([a, b], { overheadOverrides: { generalLiabilityInsurance: 3600 } }));
    expect(auto.monthlyOverhead - overridden.monthlyOverhead).toBeCloseTo((ins - 3600) / 12, 2);
    const noOwner = companyFloorBaseline(yearOf([div("A", { ...a, ownerSalaryAnnual: 0 }), div("B", { ...b, ownerSalaryAnnual: 0 })]));
    expect(auto.monthlyOverhead - noOwner.monthlyOverhead).toBeCloseTo(3000, 2);
  });

  it("blends company payroll burden by wage dollars, not headcount", () => {
    const a = div("A", { crewCount: 1, employeesPerCrew: 1, avgEmployeeHourlyRate: 10, payrollBurdenPct: 10 });
    const b = div("B", { crewCount: 1, employeesPerCrew: 1, avgEmployeeHourlyRate: 30, payrollBurdenPct: 30 });
    const c = companyFloorBaseline(yearOf([a, b]));
    expect(c.hourlyWage).toBe(20);
    expect(c.payrollBurdenPct).toBe(25); // (10*10+30*30)/(10+30)
    // burdened total labor matches sum of divisions: 2 heads * 20 * 1.25 = 11 + 39
    expect(2 * c.hourlyWage * (1 + c.payrollBurdenPct / 100)).toBeCloseTo(11 + 39, 6);
  });

  it("leaves zero crew hours at 0 so validation blocks a fake price", () => {
    const d = div("Idle", { crewCount: 0 });
    expect(divisionCrewHoursYear(d)).toBe(0);
    const b = divisionFloorBaseline(d);
    expect(b.monthlyBillableHours).toBe(0);
    expect(calculateJobPricingFloor(b).result).toBeNull();
    expect(companyFloorBaseline(yearOf([d])).monthlyBillableHours).toBe(0);
  });

  it("round-trips independent division and company scenarios", () => {
    const s1 = { ...divisionFloorBaseline(div("A", {})), onSiteMinutes: 30, monthlyBillableHours: 100 };
    const s2 = { ...s1, onSiteMinutes: 90, crewMembers: 2 };
    const s3 = { ...s1, targetMarginPct: 40 };
    const a = div("A", { id: "a", jobPricingFloor: s1 }), b = div("B", { id: "b", jobPricingFloor: s2 }), c = div("C", { id: "c" });
    const [y] = migrateBudgetPayload(JSON.parse(JSON.stringify([yearOf([a, b, c], { companyJobPricingFloor: s3 })])));
    expect(y.divisions[0].jobPricingFloor).toEqual(s1);
    expect(y.divisions[1].jobPricingFloor).toEqual(s2);
    expect(y.divisions[2].jobPricingFloor).toBeUndefined();
    expect(y.companyJobPricingFloor).toEqual(s3);
    const [bad] = migrateBudgetPayload([{ ...yearOf([div("A", { jobPricingFloor: { ...s1, monthlyBillableHours: 0 } })]) }]);
    expect(bad.divisions[0].jobPricingFloor).toBeUndefined();
  });
});
