import { describe, expect, it } from "vitest";
import { aggregateClockedTime, classifyTask, formatClockedHours, type ClockSlice } from "./clockedTimeReport";

const range = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-02T00:00:00.000Z"),
  asOf: new Date("2026-06-01T18:00:00.000Z"),
};

function slice(over: Partial<ClockSlice> = {}): ClockSlice {
  return {
    userId: 1,
    userName: "Ada",
    hourlyRate: 20,
    startedAt: "2026-06-01T12:00:00.000Z",
    endedAt: "2026-06-01T14:30:00.000Z",
    isJob: true,
    serviceName: "Mowing",
    taskType: "job",
    taskLabel: "Mow",
    jobId: 10,
    estimatedMinutes: 60,
    ...over,
  };
}

describe("clocked time aggregation", () => {
  it("formats hours as HH:MM and two-decimal hours", () => {
    expect(formatClockedHours(870)).toEqual({ hoursLabel: "14:30", decimalHours: 14.5 });
    expect(formatClockedHours(0)).toEqual({ hoursLabel: "0:00", decimalHours: 0 });
  });

  it("maps shop and drive timers onto the standard non-job tasks", () => {
    expect(classifyTask("drive", "to the job")).toEqual({ key: "travel", name: "Travel/Drive Time" });
    expect(classifyTask("shop_maintenance", null)).toEqual({ key: "shop", name: "Shop Maintenance" });
    expect(classifyTask("other", "Equipment Prep")).toEqual({ key: "equipment", name: "Equipment Prep" });
    expect(classifyTask("meeting", "Monday huddle")).toEqual({ key: "meetings", name: "Meetings" });
    expect(classifyTask("routine", "visit:4:Estimate follow-up").name).toBe("Estimate follow-up");
  });

  it("returns an empty range with the four shop tasks and no employees", () => {
    const report = aggregateClockedTime([], range);
    expect(report.totalDecimalHours).toBe(0);
    expect(report.totalLaborCost).toBe(0);
    expect(report.services).toEqual([]);
    expect(report.employees).toEqual([]);
    expect(report.tasks.map(task => task.name)).toEqual([
      "Travel/Drive Time", "Shop Maintenance", "Equipment Prep", "Meetings",
    ]);
    expect(report.tasks.every(task => task.decimalHours === 0 && task.percentOfTotal === 0 && task.varianceHours === null)).toBe(true);
  });

  it("clips open timers to the range, prices labor, and variances services against the scheduled job", () => {
    const report = aggregateClockedTime([
      slice(),
      slice({
        startedAt: "2026-06-01T16:00:00.000Z",
        endedAt: null,
        jobId: 11,
        estimatedMinutes: 30,
      }),
      slice({
        userId: 2,
        userName: "Ben",
        hourlyRate: 30,
        isJob: false,
        serviceName: null,
        taskType: "travel",
        taskLabel: "Drive time",
        jobId: null,
        estimatedMinutes: null,
        startedAt: "2026-05-31T23:00:00.000Z",
        endedAt: "2026-06-01T01:00:00.000Z",
      }),
      slice({
        startedAt: "2026-06-02T01:00:00.000Z",
        endedAt: "2026-06-02T02:00:00.000Z",
      }),
    ], range);

    const mowing = report.services.find(row => row.name === "Mowing");
    expect(mowing?.hoursLabel).toBe("4:30");
    expect(mowing?.decimalHours).toBe(4.5);
    expect(mowing?.budgetedHours).toBe(1.5);
    expect(mowing?.varianceHours).toBe(3);
    expect(mowing?.laborCost).toBe(90);
    expect(mowing?.percentOfTotal).toBe(81.82);
    const travel = report.tasks.find(task => task.key === "travel");
    expect(travel?.decimalHours).toBe(1);
    expect(travel?.laborCost).toBe(30);
    expect(travel?.budgetedHours).toBeNull();
    expect(report.totalDecimalHours).toBe(5.5);
    expect(report.totalLaborCost).toBe(120);
    expect(report.employees.map(employee => employee.userName)).toEqual(["Ada", "Ben"]);
  });

  it("splits one job's budget across the employees who clocked it and keeps each employee's service mix", () => {
    const report = aggregateClockedTime([
      slice({ userId: 1, userName: "Ada", hourlyRate: 20, endedAt: "2026-06-01T13:00:00.000Z", estimatedMinutes: 120 }),
      slice({ userId: 2, userName: "Ben", hourlyRate: 10, startedAt: "2026-06-01T13:00:00.000Z", endedAt: "2026-06-01T14:00:00.000Z", estimatedMinutes: 120 }),
      slice({
        userId: 1, userName: "Ada", isJob: false, serviceName: null, taskType: "meeting", taskLabel: "Meetings",
        jobId: null, estimatedMinutes: null, startedAt: "2026-06-01T15:00:00.000Z", endedAt: "2026-06-01T15:30:00.000Z",
      }),
    ], range);
    const ada = report.employees.find(employee => employee.userName === "Ada");
    const ben = report.employees.find(employee => employee.userName === "Ben");
    expect(ada?.rows.map(row => row.name)).toEqual(["Mowing", "Meetings"]);
    expect(ada?.rows[0].budgetedHours).toBe(1);
    expect(ben?.rows[0].budgetedHours).toBe(1);
    expect(report.services[0].budgetedHours).toBe(2);
    expect(ada?.rows[0].percentOfTotal).toBeCloseTo(66.67, 1);
    expect(ada?.laborCost).toBe(30);
    expect(ben?.laborCost).toBe(10);
    expect(report.employees[0].percentOfTotal + report.employees[1].percentOfTotal).toBe(100);
  });

  it("treats a missing pay rate as zero labor cost", () => {
    const report = aggregateClockedTime([slice({ hourlyRate: null, estimatedMinutes: null })], range);
    expect(report.services[0].laborCost).toBe(0);
    expect(report.services[0].varianceHours).toBeNull();
    expect(report.totalLaborCost).toBe(0);
  });
});
