import { describe, expect, it } from "vitest";
import { appendBudgetDivision } from "./budgetDocument";

const division = {
  id: "div-2",
  name: " Seasonal ",
  serviceIds: [],
  crewCount: "3",
  workWeeksPerYear: 28,
  workDaysPerWeek: 4,
  billableHoursPerDay: 7,
  employeesPerCrew: 2,
  customOverhead: [{ id: "oh-1", name: "Shop", monthlyAmount: 400 }],
  vehiclePayments: 900,
};

describe("appendBudgetDivision", () => {
  it("starts a year when the stored budget is null or empty", () => {
    for (const raw of [null, undefined, "", "null", [], {}]) {
      const saved = appendBudgetDivision(raw, 2026, division);
      expect(saved.years).toHaveLength(1);
      expect(saved.years[0].year).toBe(2026);
      expect(saved.years[0].divisions).toHaveLength(1);
      expect(saved.division.name).toBe("Seasonal");
      expect(saved.division.crewCount).toBe(3);
      expect(saved.division.workWeeksPerYear).toBe(28);
      expect(saved.division.customOverhead).toEqual(division.customOverhead);
      expect(saved.years[0].overheadOverrides).toEqual({});
    }
  });

  it("keeps an existing year and appends the division onto a null division list", () => {
    const saved = appendBudgetDivision([{ year: 2026, divisions: null, overheadOverrides: { fuelMaintenance: 10 } }], 2026, division);
    expect(saved.years[0].divisions.map(item => item.id)).toEqual(["div-2"]);
    expect(saved.years[0].overheadOverrides).toEqual({ fuelMaintenance: 10 });
  });

  it("turns a legacy flat budget into a division list before appending", () => {
    const saved = appendBudgetDivision({ year: 2026, name: "Main", crewCount: 2, workWeeksPerYear: 40, serviceIds: null }, 2026, division);
    expect(saved.years[0].divisions.map(item => item.name)).toEqual(["Main", "Seasonal"]);
  });

  it("drops a service the new division repeats from an earlier division", () => {
    const saved = appendBudgetDivision(
      [{ year: 2026, divisions: [{ id: "div-1", name: "Main", serviceIds: [4] }] }],
      2026,
      { ...division, serviceIds: [4, 8] },
    );
    expect(saved.division.serviceIds).toEqual([8]);
  });
});
