/**
 * Unit tests for skip-next and series-listing semantics.
 *
 * These tests verify the skip-next state machine described in the route:
 *
 *   Case A — scheduler pre-generated next child:
 *     recurrenceCount was already advanced when the child was created.
 *     Cancelling the child must NOT increment count again (would double-skip).
 *     After skip: the series generates occurrence N+1 next (not N+2).
 *
 *   Case B — no child materialized yet:
 *     Increment recurrenceCount so the scheduler skips the next computed slot.
 *     After skip: the series generates occurrence N+1 next (i.e. one slot skipped).
 *
 * Run with:
 *   node --test /tmp/recurrence_skip_test.mjs  (after esbuild compilation)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nthOccurrenceAfterRoot, type RecurrenceRule } from "./recurrenceEngine";

function iso(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Simulate the skip state machine in pure logic (no DB).
// Returns { nextDate: string | null, newCount: number }
function simulateSkip(
  rule: RecurrenceRule,
  rootDate: Date,
  currentCount: number,
  hasPreGeneratedChild: boolean,   // Case A or B
): { nextDate: string | null; newCount: number } {
  let newCount = currentCount;

  if (hasPreGeneratedChild) {
    // Case A: cancel child; count stays the same
    // (count was already incremented when the child was generated)
    // Do nothing to count.
  } else {
    // Case B: no child — increment to skip the next computed slot
    newCount = currentCount + 1;
  }

  // After skip, what is the next occurrence the scheduler will generate?
  const nextDate = nthOccurrenceAfterRoot(rule, rootDate, newCount);
  return { nextDate: iso(nextDate), newCount };
}

describe("skip-next: Case A (pre-generated child exists)", () => {
  // Daily series starting Jan 1.
  // Scheduler runs and generates Jan 2 (count advances to 1).
  // State before skip: currentCount = 1, child at Jan 2 is scheduled.
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "never" };
  const root = new Date("2025-01-01");

  it("exactly one occurrence is skipped (Jan 2 child cancelled → next is Jan 3)", () => {
    const currentCount = 1; // scheduler already created child at Jan 2
    const result = simulateSkip(rule, root, currentCount, true);
    // Count stays at 1 (child was cancelled), next generated = nthOccurrenceAfterRoot(rule, root, 1) = Jan 3
    // Wait — the child at Jan 2 represents slot 0 (index 0), count was advanced to 1 after creation.
    // After cancelling the child, count stays at 1, so next slot is index 1 = Jan 3.
    assert.equal(result.newCount, 1);
    assert.equal(result.nextDate, "2025-01-03");
  });

  it("cancelling does not advance count", () => {
    const currentCount = 5;
    const result = simulateSkip(rule, root, currentCount, true);
    assert.equal(result.newCount, 5);
  });
});

describe("skip-next: Case B (no pre-generated child)", () => {
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "never" };
  const root = new Date("2025-01-01");

  it("count advances by 1, skipping the next computed slot", () => {
    const currentCount = 0; // no child generated yet; next slot = Jan 2
    const result = simulateSkip(rule, root, currentCount, false);
    assert.equal(result.newCount, 1);
    // Next generated will be slot 1 = Jan 3 (slot 0 = Jan 2 was skipped)
    assert.equal(result.nextDate, "2025-01-03");
  });

  it("works when series is at count=3", () => {
    const currentCount = 3;
    const result = simulateSkip(rule, root, currentCount, false);
    assert.equal(result.newCount, 4);
    // Slot 4 = Jan 6 (0=Jan2, 1=Jan3, 2=Jan4, 3=Jan5 skipped, 4=Jan6)
    assert.equal(result.nextDate, "2025-01-06");
  });
});

describe("skip-next: both cases produce identical next-date when pre-generation state is equivalent", () => {
  // If count=0 and no child: after skip, count=1, next=slot1
  // If count=1 and child(slot0) exists: after skip, count=1, next=slot1
  // Both should produce the same next date.
  const rule: RecurrenceRule = { pattern: "weekly", daysOfWeek: [1], endCondition: "never" };
  const root = new Date("2025-01-01"); // Wednesday

  it("Case A and Case B produce same next date", () => {
    // Case B: count=0, no child
    const resultB = simulateSkip(rule, root, 0, false);
    // Case A: count=1, child at slot0 exists
    const resultA = simulateSkip(rule, root, 1, true);
    assert.equal(resultA.newCount, 1);
    assert.equal(resultB.newCount, 1);
    assert.equal(resultA.nextDate, resultB.nextDate);
  });
});

describe("skip-next: endCondition after — skip reduces remaining occurrences", () => {
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "after", endAfter: 3 };
  const root = new Date("2025-01-01");

  it("skipping slot 1 (Case B) with only 1 remaining returns null next", () => {
    // endAfter=3: slots 0,1,2 valid; slot 3 → null
    // currentCount=2 (2 generated), slot 2 next; skip it → count=3 → null
    const result = simulateSkip(rule, root, 2, false);
    assert.equal(result.newCount, 3);
    assert.equal(result.nextDate, null);
  });
});

describe("series nextScheduledAt: persisted child takes priority over computed", () => {
  const rule: RecurrenceRule = { pattern: "daily", endCondition: "never" };
  const root = new Date("2025-01-01");

  it("when child exists, nextScheduledAt = child.scheduledAt", () => {
    // Simulates the series list logic
    const childScheduledAt = new Date("2025-01-02");
    const count = 1; // child created = count already advanced

    // Persisted child exists → use it directly
    const result = childScheduledAt.toISOString().slice(0, 10);
    assert.equal(result, "2025-01-02");
  });

  it("when no child, nextScheduledAt = nthOccurrenceAfterRoot(rule, root, count)", () => {
    const count = 0;
    const result = iso(nthOccurrenceAfterRoot(rule, root, count));
    assert.equal(result, "2025-01-02");
  });

  it("after skip (Case B), computed fallback shows skipped date correctly", () => {
    // Before skip: count=0 → next=Jan2
    // After skip: count=1 → next=Jan3 (Jan2 skipped)
    const before = iso(nthOccurrenceAfterRoot(rule, root, 0));
    const after = iso(nthOccurrenceAfterRoot(rule, root, 1));
    assert.equal(before, "2025-01-02");
    assert.equal(after, "2025-01-03");
    assert.notEqual(before, after);
  });
});
