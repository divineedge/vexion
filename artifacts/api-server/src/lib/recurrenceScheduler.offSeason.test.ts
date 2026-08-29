import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nthOccurrenceAfterRoot, type RecurrenceRule } from "./recurrenceEngine";
import { isInOffSeason } from "./offSeasonUtils";
import { nextEligibleRecurrence, resolveRecurrenceOffSeason } from "./recurrenceScheduler";

describe("job-level recurring off-season behavior", () => {
  const weekly: RecurrenceRule = { pattern: "weekly", daysOfWeek: [1], endCondition: "never" };
  const root = new Date("2025-11-10T09:00:00.000Z");

  it("treats a job-level Nov-to-Mar window as a wraparound pause", () => {
    assert.equal(isInOffSeason(new Date("2025-12-01T09:00:00.000Z"), "11-15", "03-14"), true);
    assert.equal(isInOffSeason(new Date("2026-02-02T09:00:00.000Z"), "11-15", "03-14"), true);
    assert.equal(isInOffSeason(new Date("2026-03-16T09:00:00.000Z"), "11-15", "03-14"), false);
  });

  it("prefers the job's pause window over a service default", () => {
    assert.deepEqual(
      resolveRecurrenceOffSeason(
        { offSeasonStart: "11-15", offSeasonEnd: "03-14" },
        { offSeasonStart: "06-01", offSeasonEnd: "08-31" },
      ),
      { offSeasonStart: "11-15", offSeasonEnd: "03-14" },
    );
  });

  it("does not combine a malformed partial job window with a service window", () => {
    assert.deepEqual(
      resolveRecurrenceOffSeason(
        { offSeasonStart: "11-15", offSeasonEnd: null },
        { offSeasonStart: "06-01", offSeasonEnd: "08-31" },
      ),
      { offSeasonStart: "06-01", offSeasonEnd: "08-31" },
    );
  });

  it("selects the first recurrence after the paused slots", () => {
    let index = 0;
    let candidate = nthOccurrenceAfterRoot(weekly, root, index)!;
    while (isInOffSeason(candidate, "11-15", "03-14")) {
      index++;
      candidate = nthOccurrenceAfterRoot(weekly, root, index)!;
    }
    assert.equal(candidate.toISOString().slice(0, 10), "2026-03-16");
  });

  it("uses the same skip count/manual result for preview and manual execution", () => {
    const window = resolveRecurrenceOffSeason(
      { offSeasonStart: "11-15", offSeasonEnd: "03-14" },
      { offSeasonStart: "06-01", offSeasonEnd: "08-31" },
    );
    const eligible = nextEligibleRecurrence(weekly, root, 0, window.offSeasonStart, window.offSeasonEnd);
    assert.equal(eligible.nextDate?.toISOString().slice(0, 10), "2026-03-16");
    assert.ok(eligible.skipCount > 0);
  });
});