import { describe, expect, it } from "vitest";
import { readImportProgressChunk, successfulImportRows } from "../src/lib/importProgress";

describe("import progress stream", () => {
  it("reads a progress event split across chunks", () => {
    const first = readImportProgressChunk("", '{"type":"progress","processed":128,"total":850,"percent":15,');
    expect(first.events).toEqual([]);
    const second = readImportProgressChunk(first.rest, '"created":100,"updated":20,"skipped":3,"failed":5}\n');
    expect(second.events).toEqual([{
      type: "progress",
      processed: 128,
      total: 850,
      percent: 15,
      created: 100,
      updated: 20,
      skipped: 3,
      failed: 5,
    }]);
    expect(successfulImportRows(second.events[0] as { created: number; updated: number })).toBe(120);
  });
});
