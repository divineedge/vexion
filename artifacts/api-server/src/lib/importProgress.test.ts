import { describe, expect, it } from "vitest";
import { importProgressSnapshot, shouldReportImportProgress } from "./importProgress";

describe("import progress", () => {
  it("reports processed rows and a rounded percentage", () => {
    expect(importProgressSnapshot({
      total: 850,
      created: 100,
      updated: 20,
      skipped: 3,
      failed: 5,
    })).toMatchObject({ processed: 128, percent: 15 });
  });

  it("counts duplicate rows that are waiting for a decision", () => {
    expect(importProgressSnapshot({
      total: 10,
      created: 4,
      updated: 0,
      skipped: 1,
      failed: 0,
      duplicateCount: 5,
    })).toMatchObject({ processed: 10, percent: 100 });
  });

  it("emits on each batch boundary and on the final row", () => {
    expect(shouldReportImportProgress(24, 850)).toBe(false);
    expect(shouldReportImportProgress(25, 850)).toBe(true);
    expect(shouldReportImportProgress(50, 850)).toBe(true);
    expect(shouldReportImportProgress(850, 850)).toBe(true);
  });
});
