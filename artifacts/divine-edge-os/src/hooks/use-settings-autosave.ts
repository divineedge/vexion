import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosaveFieldTracker, createAutosaveQueue, type AutosaveQueue, type AutosaveSnapshot, type Patch } from '@/lib/settingsAutosave';
import { toast } from 'sonner';
import { customFetch } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';

/** React wrapper around createAutosaveQueue with a beforeunload guard. */
export function useSettingsAutosave(save: (patch: Patch) => Promise<unknown>, opts: { delay?: number; onSaved?: () => void } = {}) {
  const { user } = useAuth();
  const identity = useRef({ id: user?.id, tenantId: user?.tenantId });
  const latestIdentity = useRef(identity.current);
  latestIdentity.current = { id: user?.id, tenantId: user?.tenantId };
  if (identity.current.id == null && user?.id != null) identity.current = latestIdentity.current;
  const saveRef = useRef(save); saveRef.current = save;
  const onSavedRef = useRef(opts.onSaved); onSavedRef.current = opts.onSaved;
  const [snap, setSnap] = useState<AutosaveSnapshot>({ status: 'idle', error: null, hasUnsaved: false });
  const qRef = useRef<AutosaveQueue | null>(null);
  const mounted = useRef(true);
  const recoveryToast = useRef<string | number | null>(null);
  const blockUnload = useCallback((e: BeforeUnloadEvent) => {
    if (qRef.current?.snapshot().hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
  }, []);
  if (!qRef.current) {
    qRef.current = createAutosaveQueue({
      delay: opts.delay ?? 800,
      save: async p => {
        const expected = identity.current;
        if (expected.id == null || expected.tenantId == null ||
          expected.id !== latestIdentity.current.id || expected.tenantId !== latestIdentity.current.tenantId) {
          throw new Error('These edits belong to a different sign-in.');
        }
        if (!mounted.current) {
          // A recovery toast can outlive logout. Never replay an old company's
          // pending settings through a newly signed-in account's credentials.
          type Identity = { id?: number; tenantId?: number };
          const response = await customFetch<Identity & { user?: Identity }>('/api/auth/me');
          const current = response.user ?? response;
          if (current.id !== expected.id || current.tenantId !== expected.tenantId) {
            throw new Error('Sign back into the original account before retrying these edits.');
          }
        }
        return saveRef.current(p);
      },
      onChange: s => {
        if (mounted.current) setSnap(s);
        if (s.status === 'error') {
          recoveryToast.current = toast.error('Your settings could not be saved. Your edits are kept; retry to save them.', {
            id: recoveryToast.current ?? undefined, duration: Infinity,
            action: { label: 'Retry', onClick: () => { void qRef.current?.retry(); } },
          });
        }
        if (!s.hasUnsaved) {
          if (!mounted.current) window.removeEventListener('beforeunload', blockUnload);
          if (recoveryToast.current != null) { toast.dismiss(recoveryToast.current); recoveryToast.current = null; }
        }
      },
      onSaved: () => onSavedRef.current?.(),
    });
  }
  useEffect(() => {
    mounted.current = true;
    window.addEventListener('beforeunload', blockUnload);
    return () => {
      mounted.current = false;
      // Do not dispose/cancel the debounce on navigation. Finish captured edits,
      // retaining a close-page guard and a retry action if the request fails.
      // Keeping the queue usable also supports React StrictMode effect replay.
      if (qRef.current?.snapshot().hasUnsaved) void qRef.current.flush();
      else window.removeEventListener('beforeunload', blockUnload);
    };
  }, [blockUnload]);

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
export function useAutosaveFields(fields: Patch, ready: boolean, queue: (p: Patch) => void, valid = true) {
  const tracker = useRef<ReturnType<typeof createAutosaveFieldTracker> | null>(null);
  if (!tracker.current) tracker.current = createAutosaveFieldTracker();
  const json = JSON.stringify(fields);
  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  useEffect(() => {
    const changed = tracker.current!(fieldsRef.current, ready, valid);
    if (Object.keys(changed).length) queue(changed);
  }, [json, ready, queue, valid]);
}
