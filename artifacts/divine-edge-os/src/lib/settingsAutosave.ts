/**
 * Framework-free autosave queue for settings.
 * - Debounces small field patches (default 800ms) and merges them by key.
 * - Serializes saves: only one request in flight; edits made during a request
 *   are sent right after it succeeds (never concurrently, so no stale overwrite).
 * - On failure the unsent patch is kept (newer edits win) and status becomes
 *   'error' until retry() — there is no automatic retry.
 */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
export type Patch = Record<string, unknown>;
export interface AutosaveSnapshot { status: AutosaveStatus; error: unknown; hasUnsaved: boolean }

/** Observe hydration without saving it; invalid drafts never advance the baseline. */
export function createAutosaveFieldTracker() {
  let baseline: Record<string, string> | null = null;
  return (fields: Patch, ready: boolean, valid = true): Patch => {
    if (!ready) return {};
    if (!baseline) {
      baseline = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, JSON.stringify(value)]));
      return {};
    }
    if (!valid) return {};
    const changed: Patch = {};
    for (const [key, value] of Object.entries(fields)) {
      const serialized = JSON.stringify(value);
      if (baseline[key] !== serialized) { changed[key] = value; baseline[key] = serialized; }
    }
    return changed;
  };
}

export interface AutosaveQueue {
  queue(patch: Patch): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  snapshot(): AutosaveSnapshot;
  dispose(): void;
}

export function createAutosaveQueue(opts: {
  save: (patch: Patch) => Promise<unknown>;
  delay?: number;
  onChange?: (s: AutosaveSnapshot) => void;
  onSaved?: () => void;
}): AutosaveQueue {
  const delay = opts.delay ?? 800;
  let pending: Patch = {};
  let inflight: Patch | null = null;
  let status: AutosaveStatus = 'idle';
  let error: unknown = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let current: Promise<void> | null = null;

  const has = (p: Patch | null) => !!p && Object.keys(p).length > 0;
  const snapshot = (): AutosaveSnapshot => ({ status, error, hasUnsaved: has(pending) || has(inflight) });
  const emit = () => { if (!disposed) opts.onChange?.(snapshot()); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const run = async (): Promise<void> => {
    clearTimer();
    if (inflight || !has(pending)) return current ?? undefined;
    inflight = pending;
    pending = {};
    status = 'saving'; error = null; emit();
    const sending = inflight;
    try {
      await opts.save(sending);
      inflight = null;
      if (has(pending)) { current = run(); return current; }
      status = 'saved'; emit(); opts.onSaved?.();
    } catch (e) {
      pending = { ...sending, ...pending };
      inflight = null;
      status = 'error'; error = e; emit();
    }
  };

  return {
    queue(patch) {
      if (disposed || !has(patch)) return;
      pending = { ...pending, ...patch };
      if (status !== 'saving') { status = status === 'error' ? 'error' : 'pending'; }
      emit();
      if (inflight) return; // will be sent after the current request succeeds
      clearTimer();
      timer = setTimeout(() => { current = run(); }, delay);
    },
    flush() { current = run(); return current; },
    retry() { current = run(); return current; },
    snapshot,
    dispose() { disposed = true; clearTimer(); },
  };
}
