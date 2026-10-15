import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaveFieldTracker, createAutosaveQueue } from "../src/lib/settingsAutosave";

describe("settings autosave queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces and merges patches into one save", async () => {
    const save = vi.fn(async () => {});
    const q = createAutosaveQueue({ save, delay: 800 });
    q.queue({ a: 1 });
    await vi.advanceTimersByTimeAsync(500);
    q.queue({ b: 2, a: 3 });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 3, b: 2 });
    expect(q.snapshot().status).toBe("saved");
  });

  it("serializes: edits during an in-flight save are sent after it succeeds", async () => {
    let resolveFirst!: () => void;
    const calls: unknown[] = [];
    const save = vi.fn((p: Record<string, unknown>) => { calls.push(p); return calls.length === 1 ? new Promise<void>(r => { resolveFirst = r; }) : Promise.resolve(); });
    const q = createAutosaveQueue({ save, delay: 10 });
    q.queue({ a: 1 });
    await vi.advanceTimersByTimeAsync(10);
    q.queue({ b: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ a: 1 }, { b: 2 }]);
    expect(q.snapshot().hasUnsaved).toBe(false);
  });

  it("keeps failed edits, does not auto-retry, newer edits win on retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const q = createAutosaveQueue({ save, delay: 10 });
    q.queue({ a: 1, b: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(q.snapshot().status).toBe("error");
    expect(q.snapshot().hasUnsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    q.queue({ b: 2 });
    expect(q.snapshot().status).toBe("error");
    await q.retry();
    expect(save).toHaveBeenLastCalledWith({ a: 1, b: 2 });
    expect(q.snapshot().status).toBe("saved");
  });

  it("ignores empty patches and dispose cancels pending timer", async () => {
    const save = vi.fn(async () => {});
    const q = createAutosaveQueue({ save, delay: 10 });
    q.queue({});
    q.queue({ a: 1 });
    q.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes captured edits immediately when leaving before the debounce expires", async () => {
    const save = vi.fn(async () => {});
    const q = createAutosaveQueue({ save });
    q.queue({ invoiceDueDays: 15 });
    await q.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith({ invoiceDueDays: 15 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(q.snapshot()).toMatchObject({ status: "saved", hasUnsaved: false });
  });

  it("flush on navigation waits for the running save and newer edits without overlap", async () => {
    let resolve!: () => void;
    const calls: unknown[] = [];
    const q = createAutosaveQueue({ delay: 10, save: patch => {
      calls.push(patch);
      return calls.length === 1 ? new Promise<void>(r => { resolve = r; }) : Promise.resolve();
    } });
    q.queue({ rules: ["first"] });
    await vi.advanceTimersByTimeAsync(10);
    q.queue({ rules: ["latest"] });
    const finishing = q.flush();
    expect(calls).toEqual([{ rules: ["first"] }]);
    resolve();
    await finishing;
    expect(calls).toEqual([{ rules: ["first"] }, { rules: ["latest"] }]);
    expect(q.snapshot().hasUnsaved).toBe(false);
  });
});

describe("settings field observation", () => {
  it("does not save loading placeholders, hydration, or unchanged fields", () => {
    const observe = createAutosaveFieldTracker();
    expect(observe({ companyName: "" }, false)).toEqual({});
    expect(observe({ companyName: "My business", invoiceDueDays: 30 }, true)).toEqual({});
    expect(observe({ companyName: "My business", invoiceDueDays: 15 }, true)).toEqual({ invoiceDueDays: 15 });
    expect(observe({ companyName: "My business", invoiceDueDays: 15 }, true)).toEqual({});
  });

  it("holds invalid drafts, then saves the full corrected configuration", () => {
    const observe = createAutosaveFieldTracker();
    observe({ policy: { type: "none", amount: null } }, true);
    expect(observe({ policy: { type: "percent", amount: 0 } }, true, false)).toEqual({});
    expect(observe({ policy: { type: "percent", amount: 25 } }, true, true))
      .toEqual({ policy: { type: "percent", amount: 25 } });
  });

  it("also saves the first correction when an existing configuration is incomplete", () => {
    const observe = createAutosaveFieldTracker();
    expect(observe({ customFrom: "", customTo: "" }, true, false)).toEqual({});
    expect(observe({ customFrom: "2026-01-01", customTo: "" }, true, false)).toEqual({});
    expect(observe({ customFrom: "2026-01-01", customTo: "2026-01-31" }, true, true))
      .toEqual({ customFrom: "2026-01-01", customTo: "2026-01-31" });
  });
});
