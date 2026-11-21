import { describe, expect, it } from "vitest";
import { ackCovers, joinSignature, scheduleDueParts } from "./equipmentMaintenance";
import { defaultLayout, normalizeLayout, timeframeRange } from "./operationsDashboard";

describe("operations dashboard layout", () => {
  it("keeps the default widget set and rejects an unknown filter", () => {
    const layout = defaultLayout();
    expect(layout.widgets.map(widget => widget.key)).toEqual([
      "jobs_completed", "invoices_revenue", "payroll_summary", "schedule", "report_snapshots", "alerts",
    ]);
    expect(layout.widgets.every(widget => widget.visible)).toBe(true);
    const saved = normalizeLayout({
      widgets: [{ key: "alerts", visible: false, timeframe: "today", filter: "weather" }],
      taskSources: ["followup", "followup"],
    });
    expect(saved?.widgets.find(widget => widget.key === "alerts")).toMatchObject({ visible: false, filter: "weather" });
    expect(saved?.widgets).toHaveLength(6);
    expect(saved?.taskSources).toEqual(["followup"]);
    expect(normalizeLayout({
      widgets: [{ key: "alerts", visible: true, timeframe: "today", filter: "nope" }],
      taskSources: [],
    })).toBeNull();
  });

  it("bounds a timeframe to the tenant calendar", () => {
    const range = timeframeRange("today", "UTC", new Date("2026-11-21T15:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    const month = timeframeRange("month", "UTC", new Date("2026-11-21T15:00:00Z"));
    expect(month.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("clears only the maintenance signature that was acknowledged", () => {
    const parts = scheduleDueParts({
      currentHours: 40, currentMiles: null, nextServiceDueDate: "2026-01-01",
      nextServiceDueHours: 10, nextServiceDueMiles: null, today: "2026-11-21",
    });
    expect(parts).toEqual(["date:2026-01-01", "hours:10"]);
    const ack = joinSignature([...parts, "cat:warn:10"]);
    expect(ackCovers(ack, parts)).toBe(true);
    expect(ackCovers(ack, ["hours:80"])).toBe(false);
    expect(ackCovers(null, parts)).toBe(false);
  });
});
