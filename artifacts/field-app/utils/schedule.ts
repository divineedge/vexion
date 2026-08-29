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

/** Calendar key in a tenant IANA zone (independent of the device clock zone). */
export function tenantDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** A zone-neutral calendar-date carrier. UTC arithmetic prevents device-zone shifts. */
export function dateFromTenantKey(value: string | undefined, fallback: string): Date {
  const key = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function addTenantDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addTenantDateDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Formats calendar components directly; never reinterprets the key in the device timezone. */
export function formatCalendarDateKey(key: string, style: 'full' | 'monthDay' | 'weekdayNarrow'): string {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = WEEKDAYS_LONG[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  if (style === 'weekdayNarrow') return weekday[0];
  const monthDay = `${MONTHS_SHORT[month - 1]} ${day}`;
  return style === 'full' ? `${weekday}, ${monthDay}` : monthDay;
}

export function tenantDayBounds(key: string, timeZone: string): { startDate: string; endDate: string } {
  const [year, month, day] = key.split('-').map(Number);
  const toInstant = (y: number, m: number, d: number) => {
    const guess = Date.UTC(y, m - 1, d);
    const offset = (instant: number) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant));
      const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
      return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second) - instant;
    };
    let instant = guess - offset(guess);
    instant = guess - offset(instant);
    return new Date(instant).toISOString();
  };
  const next = addTenantDateDays(key, 1).split('-').map(Number);
  return { startDate: toInstant(year, month, day), endDate: toInstant(next[0], next[1], next[2]) };
}

export function tenantSchedulePeriod(mode: ScheduleMode, selectedKey: string, timeZone: string): { startDate: string; endDate: string; rangeKey: string; dayKeys: string[] } {
  const selected = new Date(`${selectedKey}T12:00:00Z`);
  const mondayOffset = (selected.getUTCDay() + 6) % 7;
  const startKey = mode === 'week' ? addTenantDateDays(selectedKey, -mondayOffset) : selectedKey;
  const count = mode === 'week' ? 7 : 1;
  const endKey = addTenantDateDays(startKey, count);
  const bounds = tenantDayBounds(startKey, timeZone);
  return { startDate: bounds.startDate, endDate: tenantDayBounds(endKey, timeZone).startDate, rangeKey: `${startKey}_${endKey}`, dayKeys: Array.from({ length: count }, (_, i) => addTenantDateDays(startKey, i)) };
}

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
      const route = (a.routeTemplateId ?? 0) - (b.routeTemplateId ?? 0);
      if (route) return route;
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