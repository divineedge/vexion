import { describe, expect, it } from "vitest";
import { billableHours, hourlyLineDescription, hourlyTotal, minutesFromTimers } from "./hourlyBillingMath";

describe("hourly billing", () => {
  it("turns clocked minutes into decimal hours and applies the minimum", () => {
    expect(billableHours(105, null)).toBe(1.75);
    expect(billableHours(20, 60)).toBe(1);
    expect(billableHours(0, 60)).toBe(0);
    expect(hourlyTotal(2.5, 65)).toBe(162.5);
    expect(hourlyLineDescription("Mowing & Weeding", 2.5, 65)).toBe("Mowing & Weeding - 2.5 hrs @ $65.00/hr");
  });

  it("adds every crew timer on the job, including one still running", () => {
    const asOf = new Date("2026-11-08T18:00:00Z");
    const minutes = minutesFromTimers([
      { startedAt: new Date("2026-11-08T16:00:00Z"), stoppedAt: new Date("2026-11-08T17:00:00Z"), elapsedSeconds: 0, adjustedStartedAt: null, adjustedStoppedAt: null, isActive: false },
      { startedAt: new Date("2026-11-08T17:15:00Z"), stoppedAt: null, elapsedSeconds: 0, adjustedStartedAt: null, adjustedStoppedAt: null, isActive: true },
    ], asOf);
    expect(minutes).toBe(105);
  });
});
