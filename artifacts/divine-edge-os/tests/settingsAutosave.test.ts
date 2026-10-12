import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaveQueue } from "../src/lib/settingsAutosave";

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
});
