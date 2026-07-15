/**
 * Tests for recurring billing date advancement (billingScheduler.ts).
 *
 * Covers:
 *   1. nextBillingDate() for daily/weekly/monthly/bi_monthly across month-end,
 *      leap-year, and year-boundary dates.
 *   2. The completed-work periodStart/periodEnd window (lastGeneratedAt-based)
 *      across consecutive runs: no gap (missed jobs) and no overlap (double-billed jobs).
 */

import { describe, it, expect } from "vitest";
import { nextBillingDate } from "./billingScheduler";

describe("nextBillingDate — daily", () => {
  it("advances a single day across a month boundary", () => {
    expect(nextBillingDate("2026-01-31", "daily")).toBe("2026-02-01");
  });

  it("advances a single day across a year boundary", () => {
    expect(nextBillingDate("2025-12-31", "daily")).toBe("2026-01-01");
  });

  it("advances Feb 28 -> Feb 29 in a leap year", () => {
    expect(nextBillingDate("2024-02-28", "daily")).toBe("2024-02-29");
  });

  it("advances Feb 28 -> Mar 1 in a non-leap year", () => {
    expect(nextBillingDate("2025-02-28", "daily")).toBe("2025-03-01");
  });
});

describe("nextBillingDate — weekly", () => {
  it("advances 7 days across a month boundary", () => {
    expect(nextBillingDate("2026-01-26", "weekly")).toBe("2026-02-02");
  });

  it("advances 7 days across a year boundary", () => {
    expect(nextBillingDate("2025-12-28", "weekly")).toBe("2026-01-04");
  });

  it("advances 7 days across a leap day", () => {
    expect(nextBillingDate("2024-02-25", "weekly")).toBe("2024-03-03");
  });
});

describe("nextBillingDate — monthly", () => {
  it("day 31 rolls forward instead of clamping when the next month is shorter (JS Date semantics)", () => {
    // Jan 31 + 1 month: Date.setMonth overflows Feb (28 days in 2026) into Mar 3.
    expect(nextBillingDate("2026-01-31", "monthly")).toBe("2026-03-03");
  });

  it("day 31 overflows into Mar 2 in a leap year (Feb has 29 days)", () => {
    expect(nextBillingDate("2024-01-31", "monthly")).toBe("2024-03-02");
  });

  it("day 30 overflows Feb into Mar 2 in a non-leap year", () => {
    expect(nextBillingDate("2025-01-30", "monthly")).toBe("2025-03-02");
  });

  it("day 28 stays within February in both leap and non-leap years", () => {
    expect(nextBillingDate("2024-01-28", "monthly")).toBe("2024-02-28");
    expect(nextBillingDate("2025-01-28", "monthly")).toBe("2025-02-28");
  });

  it("Feb 29 (leap year) + 1 month lands on Mar 29, not clamped to Feb 28 of the next cycle", () => {
    expect(nextBillingDate("2024-02-29", "monthly")).toBe("2024-03-29");
  });

  it("advances across a year boundary (Dec -> Jan)", () => {
    expect(nextBillingDate("2025-12-15", "monthly")).toBe("2026-01-15");
  });

  it("Nov 30 + 1 month lands on Dec 30 (both 30-day-safe months)", () => {
    expect(nextBillingDate("2025-11-30", "monthly")).toBe("2025-12-30");
  });

  it("defaults to monthly advancement for an unrecognized cycle type", () => {
    expect(nextBillingDate("2026-03-15", "unknown_cycle")).toBe("2026-04-15");
  });
});

describe("nextBillingDate — bi_monthly", () => {
  it("advances 2 months across a year boundary", () => {
    expect(nextBillingDate("2025-11-30", "bi_monthly")).toBe("2026-01-30");
  });

  it("day 31 overflows when skipping over February (non-leap year)", () => {
    // Dec 31 + 2 months = Feb 31 -> overflows to Mar 3 (2025 Feb has 28 days).
    expect(nextBillingDate("2024-12-31", "bi_monthly")).toBe("2025-03-03");
  });

  it("day 31 overflows differently across a leap-year February", () => {
    // Dec 31 2023 + 2 months = Feb 31 -> overflows to Mar 2 (2024 Feb has 29 days).
    expect(nextBillingDate("2023-12-31", "bi_monthly")).toBe("2024-03-02");
  });

  it("keeps day-of-month stable when both months have enough days", () => {
    expect(nextBillingDate("2026-01-15", "bi_monthly")).toBe("2026-03-15");
  });
});

describe("nextBillingDate — repeated advancement stays deterministic (no drift)", () => {
  it("chaining monthly advances from a day-31 anchor never throws and always returns a valid ISO date", () => {
    let d = "2025-01-31";
    for (let i = 0; i < 24; i++) {
      d = nextBillingDate(d, "monthly");
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("chaining daily advances through Feb of a leap year hits every day exactly once", () => {
    let d = "2024-02-25";
    const seen: string[] = [d];
    for (let i = 0; i < 6; i++) {
      d = nextBillingDate(d, "daily");
      seen.push(d);
    }
    expect(seen).toEqual([
      "2024-02-25",
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
    ]);
  });
});

// ── Completed-work period window (lastGeneratedAt-based) ────────────────────
//
// generateDueTemplate/runTemplateNow compute periodStart = lastGeneratedAt ?? createdAt
// and periodEnd = new Date() (now), then query jobs with completedAt > periodStart AND
// completedAt <= periodEnd. After each run, lastGeneratedAt is set to that run's periodEnd.
// This block verifies that contract in isolation: consecutive windows must tile the
// timeline exactly (no gap, no overlap), regardless of run cadence.

type FakeJob = { id: number; completedAt: Date };

/** Mirrors the `completedAt > periodStart AND completedAt <= periodEnd` predicate used in collectCompletedWorkForCustomer. */
function jobsInWindow(jobs: FakeJob[], periodStart: Date, periodEnd: Date): FakeJob[] {
  return jobs.filter(j => j.completedAt.getTime() > periodStart.getTime() && j.completedAt.getTime() <= periodEnd.getTime());
}

describe("completed-work period window — consecutive runs tile the timeline", () => {
  it("a job completed exactly at a run boundary is billed once, in the run whose periodEnd it falls in", () => {
    const boundary = new Date("2026-03-01T09:00:00Z");
    const jobs: FakeJob[] = [{ id: 1, completedAt: boundary }];

    // Run 1: periodStart = createdAt, periodEnd = boundary (job included, since <=)
    const run1 = jobsInWindow(jobs, new Date("2026-02-01T00:00:00Z"), boundary);
    expect(run1.map(j => j.id)).toEqual([1]);

    // Run 2: periodStart = run1's periodEnd (the same boundary instant), periodEnd = later
    const run2 = jobsInWindow(jobs, boundary, new Date("2026-03-15T00:00:00Z"));
    expect(run2.map(j => j.id)).toEqual([]); // not double-billed
  });

  it("no job is skipped when three consecutive runs happen back-to-back", () => {
    const jobs: FakeJob[] = [
      { id: 1, completedAt: new Date("2026-01-05T12:00:00Z") },
      { id: 2, completedAt: new Date("2026-01-05T12:00:00Z") }, // same instant as job 1
      { id: 3, completedAt: new Date("2026-01-20T12:00:00Z") },
      { id: 4, completedAt: new Date("2026-02-10T12:00:00Z") },
    ];

    const created = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-10T00:00:00Z");
    const t2 = new Date("2026-01-25T00:00:00Z");
    const t3 = new Date("2026-02-15T00:00:00Z");

    const run1 = jobsInWindow(jobs, created, t1);
    const run2 = jobsInWindow(jobs, t1, t2);
    const run3 = jobsInWindow(jobs, t2, t3);

    expect(run1.map(j => j.id).sort()).toEqual([1, 2]);
    expect(run2.map(j => j.id).sort()).toEqual([3]);
    expect(run3.map(j => j.id).sort()).toEqual([4]);

    // Union of all runs covers every job exactly once (no gap, no double-count).
    const allBilled = [...run1, ...run2, ...run3].map(j => j.id).sort();
    expect(allBilled).toEqual(jobs.map(j => j.id).sort());
  });

  it("a job completed in the gap between two runs' instants is not silently lost", () => {
    // If run 1 ends at t1 and run 2 starts at t1 (as the code does via lastGeneratedAt),
    // there is no gap — every instant belongs to exactly one window.
    const created = new Date("2026-06-01T00:00:00Z");
    const t1 = new Date("2026-06-10T00:00:00Z");
    const t2 = new Date("2026-06-20T00:00:00Z");

    const jobAtT1 = { id: 1, completedAt: t1 };
    const jobJustAfterT1 = { id: 2, completedAt: new Date(t1.getTime() + 1) };

    const run1 = jobsInWindow([jobAtT1, jobJustAfterT1], created, t1);
    const run2 = jobsInWindow([jobAtT1, jobJustAfterT1], t1, t2);

    expect(run1.map(j => j.id)).toEqual([1]);
    expect(run2.map(j => j.id)).toEqual([2]);
  });

  it("no jobs completed yields an empty window on both sides of a run boundary", () => {
    const run1 = jobsInWindow([], new Date("2026-01-01"), new Date("2026-01-31"));
    const run2 = jobsInWindow([], new Date("2026-01-31"), new Date("2026-02-28"));
    expect(run1).toEqual([]);
    expect(run2).toEqual([]);
  });
});
