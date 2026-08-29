export type ScheduleMode = 'day' | 'week';

export type ScheduleJob = {
  id: number;
  scheduledAt: string;
  priority?: string | null;
  sequenceOrder?: number | null;
  routeTemplateId?: number | null;
};

export type SchedulePeriod = {
  startDate: string;
  endDate: string;
  rangeKey: string;
  days: Date[];
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Local YYYY-MM-DD, deliberately not UTC so a field worker's calendar day is respected. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromLocalKey(value: string | undefined, fallback = new Date()): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfLocalDay(fallback);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return localDateKey(parsed) === value ? parsed : startOfLocalDay(fallback);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function mondayOfWeek(date: Date): Date {
  const day = startOfLocalDay(date).getDay();
  return addLocalDays(date, day === 0 ? -6 : 1 - day);
}

/** API ranges are [startDate, endDate): safe for late-day jobs and DST transitions. */
export function schedulePeriod(mode: ScheduleMode, selectedDate: Date): SchedulePeriod {
  const start = mode === 'week' ? mondayOfWeek(selectedDate) : startOfLocalDay(selectedDate);
  const length = mode === 'week' ? 7 : 1;
  const end = addLocalDays(start, length);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    rangeKey: `${localDateKey(start)}_${localDateKey(end)}`,
    days: Array.from({ length }, (_, index) => addLocalDays(start, index)),
  };
}

export function jobLocalDateKey(job: Pick<ScheduleJob, 'scheduledAt'>): string {
  return localDateKey(new Date(job.scheduledAt));
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Routes first by stop sequence; everything else by priority, then scheduled time. */
export function sortScheduleJobs(jobs: ScheduleJob[]): ScheduleJob[] {
  return [...jobs].sort((a, b) => {
    const aRoute = a.routeTemplateId != null;
    const bRoute = b.routeTemplateId != null;
    if (aRoute !== bRoute) return aRoute ? -1 : 1;
    if (aRoute && bRoute) {
      const sequence = (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER);
      if (sequence) return sequence;
    }
    const priority = (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2);
    return priority || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });
}

export function groupJobsByDay<T extends ScheduleJob>(jobs: T[], days: Date[]): { date: Date; key: string; jobs: T[] }[] {
  const grouped = new Map<string, T[]>();
  for (const job of jobs) {
    const key = jobLocalDateKey(job);
    grouped.set(key, [...(grouped.get(key) ?? []), job]);
  }
  return days.map(date => {
    const key = localDateKey(date);
    return { date, key, jobs: sortScheduleJobs(grouped.get(key) ?? []) as T[] };
  });
}