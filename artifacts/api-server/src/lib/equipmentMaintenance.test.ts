import { describe, expect, it } from "vitest";
import { maintenanceDue, thresholdFor } from "./equipmentMaintenance";

describe("equipment maintenance thresholds", () => {
  const rules = [{
    category: "Mower",
    warnHours: 400,
    retireHours: 2000,
    intervals: [{ label: "Oil change", everyHours: 100 }, { label: "Blade sharpen", everyHours: 50 }],
  }];

  it("matches a category and reports each crossed interval once per bucket", () => {
    const rule = thresholdFor("mower", rules);
    expect(maintenanceDue(120, rule).map(item => item.bucket)).toEqual(["Oil change:1", "Blade sharpen:2"]);
    expect(maintenanceDue(400, rule).some(item => item.bucket === "warn:400")).toBe(true);
    expect(maintenanceDue(40, rule)).toEqual([]);
  });
});
