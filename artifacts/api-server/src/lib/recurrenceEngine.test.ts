/**
 * Unit tests for the recurrence engine.
 * Run with: npx tsx --test src/lib/recurrenceEngine.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nthOccurrenceAfterRoot, describeRule, type RecurrenceRule } from "./recurrenceEngine";

// Helpers
function d(iso: string): Date {
  return new Date(iso);
}
function iso(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily
// ─────────────────────────────────────────────────────────────────────────────
describe("daily pattern", () => {
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "never" };

  it("n=0 returns root+1 day", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 0)), "2025-01-02");
  });
  it("n=6 returns root+7 days", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 6)), "2025-01-08");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom interval
// ─────────────────────────────────────────────────────────────────────────────
describe("custom pattern", () => {
  const rule: RecurrenceRule = { pattern: "custom", interval: 14, endCondition: "never" };

  it("n=0 returns root+14", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-03-01"), 0)), "2025-03-15");
  });
  it("n=2 returns root+42", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-03-01"), 2)), "2025-04-12");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekly (single day)
// ─────────────────────────────────────────────────────────────────────────────
describe("weekly pattern (single day)", () => {
  // Root = Wednesday 2025-01-01, repeats every Thursday (4)
  const rule: RecurrenceRule = { pattern: "weekly", daysOfWeek: [4], endCondition: "never" };

  it("n=0: next Thursday after Wednesday Jan 1", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 0)), "2025-01-02");
  });
  it("n=1: the Thursday after that", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 1)), "2025-01-09");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekly (multiple days)
// ─────────────────────────────────────────────────────────────────────────────
describe("weekly pattern (Mon+Thu)", () => {
  // Root = Monday 2025-01-06
  const rule: RecurrenceRule = { pattern: "weekly", daysOfWeek: [1, 4], endCondition: "never" };

  it("n=0: next Thu after Monday Jan 6", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-06"), 0)), "2025-01-09");
  });
  it("n=1: next Mon after that Thu", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-06"), 1)), "2025-01-13");
  });
  it("n=2: next Thu in second week", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-06"), 2)), "2025-01-16");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Monthly by date — key edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("monthly_date pattern", () => {
  it("normal: Jan 15 → Feb 15", () => {
    const rule: RecurrenceRule = { pattern: "monthly_date", dayOfMonth: 15, endCondition: "never" };
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-15"), 0)), "2025-02-15");
  });

  it("overflow: Jan 31 → Feb 28 (not Mar 3)", () => {
    const rule: RecurrenceRule = { pattern: "monthly_date", dayOfMonth: 31, endCondition: "never" };
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-31"), 0)), "2025-02-28");
  });

  it("overflow: Jan 31 → Mar 31 on n=1", () => {
    const rule: RecurrenceRule = { pattern: "monthly_date", dayOfMonth: 31, endCondition: "never" };
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-31"), 1)), "2025-03-31");
  });

  it("leap year: Jan 29 → Feb 29 (2028 leap)", () => {
    const rule: RecurrenceRule = { pattern: "monthly_date", dayOfMonth: 29, endCondition: "never" };
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2028-01-29"), 0)), "2028-02-29");
  });

  it("non-leap year: Jan 29 → Feb 28 (2025)", () => {
    const rule: RecurrenceRule = { pattern: "monthly_date", dayOfMonth: 29, endCondition: "never" };
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-29"), 0)), "2025-02-28");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Monthly by weekday
// ─────────────────────────────────────────────────────────────────────────────
describe("monthly_weekday pattern", () => {
  // Root = any day in Jan 2025; first Monday = Jan 6
  const rule: RecurrenceRule = {
    pattern: "monthly_weekday",
    weekOfMonth: 1,
    dayOfWeek: 1, // Monday
    endCondition: "never",
  };

  it("n=0: first Monday of Feb 2025 = Feb 3", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-06"), 0)), "2025-02-03");
  });
  it("n=1: first Monday of Mar 2025 = Mar 3", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-06"), 1)), "2025-03-03");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End conditions
// ─────────────────────────────────────────────────────────────────────────────
describe("endCondition: after", () => {
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "after", endAfter: 3 };

  it("n=2 (last valid) returns a date", () => {
    assert.notEqual(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 2), null);
  });
  it("n=3 (first exhausted) returns null", () => {
    assert.equal(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 3), null);
  });
});

describe("endCondition: on_date (inclusive)", () => {
  // Daily from Jan 1, end date Jan 3 — occurrences: Jan 2, Jan 3 (inclusive)
  const rule: RecurrenceRule = {
    pattern: "daily",
    endCondition: "on_date",
    endDate: "2025-01-03",
  };

  it("n=0 (Jan 2) is before cutoff — allowed", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 0)), "2025-01-02");
  });
  it("n=1 (Jan 3) equals cutoff — INCLUSIVE, allowed", () => {
    assert.equal(iso(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 1)), "2025-01-03");
  });
  it("n=2 (Jan 4) is after cutoff — null", () => {
    assert.equal(nthOccurrenceAfterRoot(rule, d("2025-01-01"), 2), null);
  });

  it("same-day: occurrence at 10:00 on end date is allowed", () => {
    // Root has a time component; end date is the same calendar day
    const root = new Date("2025-01-02T10:00:00.000Z");
    const r2: RecurrenceRule = { pattern: "daily", endCondition: "on_date", endDate: "2025-01-03" };
    // n=0 → Jan 3 at 10:00 — must not be rejected by midnight comparison
    assert.equal(iso(nthOccurrenceAfterRoot(r2, root, 0)), "2025-01-03");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describeRule
// ─────────────────────────────────────────────────────────────────────────────
describe("describeRule", () => {
  it("daily", () => {
    assert.equal(describeRule({ pattern: "daily", endCondition: "never" }), "Every day");
  });
  it("weekly Mon+Thu", () => {
    assert.equal(
      describeRule({ pattern: "weekly", daysOfWeek: [1, 4], endCondition: "never" }),
      "Every Mon & Thu",
    );
  });
  it("monthly_date with after end", () => {
    assert.equal(
      describeRule({ pattern: "monthly_date", dayOfMonth: 15, endCondition: "after", endAfter: 12 }),
      "Monthly on the 15, 12 times",
    );
  });
});
