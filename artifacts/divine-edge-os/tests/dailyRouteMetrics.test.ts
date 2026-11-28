import { describe, expect, it } from "vitest";
import {
  capabilitiesFor,
  completionLabel,
  effectiveHourly,
  formatEta,
  formatHourly,
  formatMoney,
  remainingWorkMinutes,
  routeMoney,
  visibleCrews,
} from "../src/lib/dailyRouteMetrics";

const job = (overrides: Partial<Parameters<typeof routeMoney>[0][number]> = {}) => ({
  id: 1,
  status: "scheduled",
  payout: 40,
  callbackDeduction: 0,
  isCallback: false,
  estimatedMinutes: 45,
  actualMinutes: null,
  clockInAt: null,
  ...overrides,
});

describe("daily route metrics", () => {
  it("subtracts an active callback and shows the deduction label", () => {
    const money = routeMoney([
      job({ id: 1, payout: 55, status: "completed", actualMinutes: 36, estimatedMinutes: 45 }),
      job({ id: 2, payout: 0, isCallback: true, callbackDeduction: 35, estimatedMinutes: 30 }),
    ]);
    expect(money.net).toBe(20);
    expect(money.deduction).toBe(35);
    expect(`${formatMoney(-money.deduction)} callback deduction`).toBe("-$35.00 callback deduction");
    expect(money.completed).toBe(1);
  });

  it("uses projected hourly before the shift and earned hourly after it starts", () => {
    const start = new Date("2026-11-28T14:00:00.000Z");
    const before = effectiveHourly({
      net: 100, earned: 0, jobMinutes: 180, driveMinutes: 60, shiftStart: start, now: new Date(start.getTime() - 60_000),
    });
    expect(before).toBeCloseTo(25);
    const during = effectiveHourly({
      net: 100, earned: 40, jobMinutes: 180, driveMinutes: 60, shiftStart: start, now: new Date(start.getTime() + 2 * 3_600_000),
    });
    expect(during).toBeCloseTo(20);
    expect(formatHourly(during)).toBe("$20.00 / hr");
    expect(formatHourly(-17.5)).toBe("-$17.50 / hr");
  });

  it("counts callback duration without a red overtime label", () => {
    const now = new Date("2026-11-28T16:00:00.000Z");
    const jobs = [
      job({ id: 1, status: "completed", estimatedMinutes: 45 }),
      job({ id: 2, status: "in_progress", estimatedMinutes: 45, clockInAt: new Date(now.getTime() - 22 * 60_000).toISOString() }),
      job({ id: 3, status: "scheduled", isCallback: true, payout: 0, callbackDeduction: 35, estimatedMinutes: 30 }),
    ];
    const legs = [
      { toId: 1, durationMinutes: 8 },
      { toId: 2, durationMinutes: 6 },
      { toId: 3, durationMinutes: 5 },
      { toId: null, durationMinutes: 7 },
    ];
    expect(remainingWorkMinutes(jobs, legs, now)).toBe((45 - 22) + 30 + 5 + 7);
    expect(completionLabel(job({ status: "completed", actualMinutes: 36, estimatedMinutes: 45 }))).toEqual({
      tone: "green", text: "Done in 36m • 9m ahead",
    });
    expect(completionLabel(job({ status: "completed", actualMinutes: 52, estimatedMinutes: 40 }))).toEqual({
      tone: "slate", text: "Done in 52m",
    });
    expect(formatEta(new Date(2026, 10, 28, 15, 42))).toBe("3:42 PM");
  });

  it("hides other routes from a crew and limits a manager to their crews", () => {
    expect(capabilitiesFor("crew").switchViews).toBe(false);
    expect(capabilitiesFor("crew").simulateRole).toBe(false);
    expect(capabilitiesFor("crew").optimizeAll).toBe(false);
    expect(capabilitiesFor("crew").logCallback).toBe(false);
    expect(capabilitiesFor("manager")).toMatchObject({ optimizeAll: true, logCallback: true, reassign: false, simulateRole: false });
    expect(capabilitiesFor("owner").simulateRole).toBe(true);
    const crews = [
      { id: 1, managerId: 10, name: "North Route" },
      { id: 2, managerId: 10, name: "South Route" },
      { id: 3, managerId: 11, name: "West Route" },
    ];
    expect(visibleCrews({ role: "crew", viewerId: 1, realRole: "owner", crews, myCrewIds: [], managers: [] }).map(crew => crew.name)).toEqual(["North Route"]);
    expect(visibleCrews({
      role: "manager", viewerId: 99, realRole: "owner", crews, myCrewIds: [], managers: [{ id: 10 }],
    }).map(crew => crew.name)).toEqual(["North Route", "South Route"]);
    expect(visibleCrews({ role: "owner", viewerId: 1, realRole: "owner", crews, myCrewIds: [], managers: [] })).toHaveLength(3);
  });
});
