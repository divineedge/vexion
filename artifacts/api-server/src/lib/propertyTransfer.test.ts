import { describe, expect, it } from "vitest";
import { propertyTransferPlan } from "./propertyTransfer";

describe("propertyTransferPlan", () => {
  it("keeps completed service dates and detaches every prior job", () => {
    const plan = propertyTransferPlan([
      { id: 1, status: "completed", completedAt: new Date("2026-05-01T12:00:00Z"), scheduledAt: new Date("2026-05-01T08:00:00Z"), serviceId: 9, serviceName: "Mowing", title: "Weekly mow" },
      { id: 2, status: "scheduled", completedAt: null, scheduledAt: new Date("2026-11-01T08:00:00Z"), serviceId: 9, serviceName: "Mowing", title: "Weekly mow" },
      { id: 3, status: "cancelled", completedAt: null, scheduledAt: new Date("2026-04-01T08:00:00Z"), serviceId: null, serviceName: null, title: "Skipped" },
    ]);
    expect(plan.logs).toEqual([
      { sourceJobId: 1, serviceId: 9, serviceName: "Mowing", performedAt: new Date("2026-05-01T12:00:00Z") },
    ]);
    expect(plan.cancelJobIds).toEqual([2]);
    expect(plan.detachJobIds).toEqual([1, 2, 3]);
  });

  it("uses the job title when a completed visit has no service name", () => {
    const plan = propertyTransferPlan([
      { id: 4, status: "completed", completedAt: null, scheduledAt: new Date("2026-01-02T00:00:00Z"), serviceId: null, serviceName: null, title: "Aeration" },
    ]);
    expect(plan.logs[0].serviceName).toBe("Aeration");
    expect(plan.logs[0].performedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});
