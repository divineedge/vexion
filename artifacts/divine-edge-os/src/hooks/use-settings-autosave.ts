import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosaveQueue, type AutosaveQueue, type AutosaveSnapshot, type Patch } from '@/lib/settingsAutosave';

/** React wrapper around createAutosaveQueue with a beforeunload guard. */
export function useSettingsAutosave(save: (patch: Patch) => Promise<unknown>, opts: { delay?: number; onSaved?: () => void } = {}) {
  const saveRef = useRef(save); saveRef.current = save;
  const onSavedRef = useRef(opts.onSaved); onSavedRef.current = opts.onSaved;
  const [snap, setSnap] = useState<AutosaveSnapshot>({ status: 'idle', error: null, hasUnsaved: false });
  const qRef = useRef<AutosaveQueue | null>(null);
  if (!qRef.current) {
    qRef.current = createAutosaveQueue({
      delay: opts.delay ?? 800,
      save: p => saveRef.current(p),
      onChange: setSnap,
      onSaved: () => onSavedRef.current?.(),
    });
  }
  useEffect(() => () => qRef.current?.dispose(), []);

  useEffect(() => {
    if (!snap.hasUnsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [snap.hasUnsaved]);

  const queue = useCallback((p: Patch) => qRef.current!.queue(p), []);
  const flush = useCallback(() => qRef.current!.flush(), []);
  const retry = useCallback(() => qRef.current!.retry(), []);
  return { ...snap, queue, flush, retry };
}

/**
 * Watches a record of already-serialized field values and queues only keys that
 * changed since the last observed value. The first observation after `ready`
 * becomes the baseline (nothing saved on hydration).
 */
export function useAutosaveFields(fields: Patch, ready: boolean, queue: (p: Patch) => void) {
  const baseline = useRef<Record<string, string> | null>(null);
  const json = JSON.stringify(fields);
  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  useEffect(() => {
    if (!ready) return;
    const cur = fieldsRef.current;
    if (!baseline.current) {
      baseline.current = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, JSON.stringify(v)]));
      return;
    }
    const changed: Patch = {};
    for (const [k, v] of Object.entries(cur)) {
      const s = JSON.stringify(v);
      if (baseline.current[k] !== s) { changed[k] = v; baseline.current[k] = s; }
    }
    if (Object.keys(changed).length) queue(changed);
  }, [json, ready, queue]);
}
