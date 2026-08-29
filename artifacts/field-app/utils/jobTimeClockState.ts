export type ClockScheduleItem = {
  id: number;
  kind: 'job' | 'visit';
  activeTimerId?: number | null;
  activeTimerStartedAt?: string | null;
  elapsedSeconds?: number;
};

export type ActiveTimer = { id: number; jobId?: number | null; startedAt: string; elapsedSeconds?: number };

export function resolveWithTimeout<T>(work: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    Promise.resolve().then(work).then(value => {
      clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

/** Applies the only-active-job invariant locally while a start request is in flight. */
export function optimisticClockIn<T extends ClockScheduleItem>(items: T[] | undefined, jobId: number, startedAt: string): T[] | undefined {
  return items?.map(item => ({
    ...item,
    activeTimerId: item.kind === 'job' && item.id === jobId ? -1 : null,
    activeTimerStartedAt: item.kind === 'job' && item.id === jobId ? startedAt : null,
    elapsedSeconds: item.kind === 'job' && item.id === jobId ? 0 : item.elapsedSeconds,
  })) as T[];
}

export function optimisticClockOut<T extends ClockScheduleItem>(items: T[] | undefined, jobId: number): T[] | undefined {
  return items?.map(item => item.kind === 'job' && item.id === jobId
    ? { ...item, activeTimerId: null, activeTimerStartedAt: null, elapsedSeconds: 0 }
    : item) as T[];
}

/** Makes offline/cached job rows accurately reflect the independently fetched active timer. */
export function mergeFallbackJobs<T extends ClockScheduleItem>(items: T[], timers: ActiveTimer[] | undefined): T[] {
  return items.map(item => {
    const timer = timers?.find(candidate => candidate.jobId === item.id) ?? null;
    return timer ? {
      ...item, activeTimerId: timer.id, activeTimerStartedAt: timer.startedAt,
      elapsedSeconds: timer.elapsedSeconds ?? item.elapsedSeconds,
    } : item;
  });
}