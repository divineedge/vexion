import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_BILLABLE_MINUTES_SQL, isJobBillableMinutesMissing } from "./jobBillableMinutes";

describe("job billable minutes column", () => {
  it("recognizes the wrapped missing-column error from the schedule list", () => {
    const cause = Object.assign(new Error("column jobs.billable_minutes does not exist"), { code: "42703" });
    const wrapped = new Error('Failed query: select "jobs"."billable_minutes" from "jobs"', { cause });
    expect(isJobBillableMinutesMissing(wrapped)).toBe(true);
  });

  it("ignores a different missing column", () => {
    const cause = Object.assign(new Error('column "archived_at" does not exist'), { code: "42703" });
    const wrapped = new Error('Failed query: select "jobs"."billable_minutes" from "jobs"', { cause });
    expect(isJobBillableMinutesMissing(wrapped)).toBe(false);
  });

  it("is added at startup without rewriting existing job rows", () => {
    const startup = readFileSync(new URL("./schemaSafety.ts", import.meta.url), "utf8");
    expect(startup).toContain("JOB_BILLABLE_MINUTES_SQL");
    expect(JOB_BILLABLE_MINUTES_SQL).toContain("IF NOT EXISTS");
    expect(JOB_BILLABLE_MINUTES_SQL).not.toMatch(/UPDATE\s+jobs/i);
  });
});
