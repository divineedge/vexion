import { describe, expect, it } from "vitest";
import {
  distributedWindowDates, intervalDates, orderPlanServices, serviceForVisit,
  projectScheduleDates, PlanScheduleError,
} from "./planFrequency";

describe("plan frequency", () => {
  it("locks the first and last visit and spaces the rest evenly", () => {
    const dates = distributedWindowDates("2026-04-01", "2026-10-01", 4);
    expect(dates).toEqual(["2026-04-01", "2026-06-01", "2026-08-01", "2026-10-01"]);
    expect(dates[0]).toBe("2026-04-01");
    expect(dates.at(-1)).toBe("2026-10-01");
  });

  it("places every seventh week through the window", () => {
    expect(intervalDates("2026-03-02", "2026-05-25", 7)).toEqual(["2026-03-02", "2026-04-20"]);
  });

  it("assigns visits to services in the saved order, then repeats", () => {
    const services = orderPlanServices([
      { serviceId: 9, serviceName: "Weed", frequencyDays: 49, sequence: 3 },
      { serviceId: 2, serviceName: "Fert", frequencyDays: 49, sequence: 1 },
      { serviceId: 5, serviceName: "Aeration", frequencyDays: 49, sequence: 2 },
    ]);
    const dates = projectScheduleDates({
      mode: "fixed_count", visitCount: 4, windowStart: "2026-04-01", windowEnd: "2026-10-01",
    }, "2026-01-01", "2026-12-31");
    expect(dates.map((_, index) => serviceForVisit(services, index).serviceName)).toEqual([
      "Fert", "Aeration", "Weed", "Fert",
    ]);
  });

  it("rejects a window that cannot hold the requested count", () => {
    expect(() => distributedWindowDates("2026-04-01", "2026-04-02", 4)).toThrow(PlanScheduleError);
  });
});
