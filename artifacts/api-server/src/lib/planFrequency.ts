/**
 * Plan frequency and service sequence. Pure date math — no database import.
 * Calendar dates are YYYY-MM-DD so the result does not depend on the server timezone.
 */

export type PlanScheduleMode = "interval" | "fixed_count" | "weekly" | "monthly" | "custom";

export interface PlanScheduleRule {
  mode: PlanScheduleMode;
  /** Every N weeks when mode is interval. */
  intervalWeeks?: number | null;
  /** Exact visit count when mode is fixed_count. */
  visitCount?: number | null;
  /** Inclusive window start, YYYY-MM-DD. */
  windowStart?: string | null;
  /** Inclusive window end, YYYY-MM-DD. */
  windowEnd?: string | null;
}

export interface SequencedService {
  serviceId: number;
  serviceName: string;
  frequencyDays: number;
  sequence?: number;
}

const DAY = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class PlanScheduleError extends Error {}

function parseKey(key: string): number {
  if (!DATE_KEY.test(key)) throw new PlanScheduleError("Enter dates as YYYY-MM-DD.");
  const instant = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== key) {
    throw new PlanScheduleError("Enter a real calendar date.");
  }
  return instant;
}

function keyFromInstant(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export function addCalendarDays(key: string, days: number): string {
  return keyFromInstant(parseKey(key) + days * DAY);
}

/**
 * Lock visit 1 on start and visit N on end. Interior visits split the span
 * into equal day counts, rounded to the nearest day, and never share a date.
 */
export function distributedWindowDates(start: string, end: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 366) {
    throw new PlanScheduleError("Choose between 1 and 366 services in the window.");
  }
  const startMs = parseKey(start);
  const endMs = parseKey(end);
  const span = Math.round((endMs - startMs) / DAY);
  if (count === 1) return [start];
  if (span < count - 1) throw new PlanScheduleError("The window is shorter than the number of services.");
  const used = new Set<number>();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    let offset = i === 0 ? 0 : i === count - 1 ? span : Math.round((span * i) / (count - 1));
    while (used.has(offset) && offset < span) offset += 1;
    if (used.has(offset)) throw new PlanScheduleError("These services would land on the same day. Extend the window.");
    used.add(offset);
    offsets.push(offset);
  }
  return offsets.map(offset => keyFromInstant(startMs + offset * DAY));
}

/** One visit every `weeks` weeks, including the start date, through the end date. */
export function intervalDates(start: string, end: string, weeks: number): string[] {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new PlanScheduleError("Choose an interval between 1 and 52 weeks.");
  }
  const endMs = parseKey(end);
  if (parseKey(start) > endMs) throw new PlanScheduleError("The end date must be on or after the start date.");
  const dates: string[] = [];
  let cursor = start;
  while (parseKey(cursor) <= endMs) {
    dates.push(cursor);
    if (dates.length > 366) throw new PlanScheduleError("This interval produces more than 366 visits. Shorten the window.");
    cursor = addCalendarDays(cursor, weeks * 7);
  }
  return dates;
}

export function orderPlanServices<T extends { sequence?: number | null }>(services: T[]): T[] {
  return services
    .map((service, index) => ({ service, index }))
    .sort((a, b) => (a.service.sequence ?? a.index + 1) - (b.service.sequence ?? b.index + 1) || a.index - b.index)
    .map(entry => entry.service);
}

export function serviceForVisit<T>(services: T[], visitIndex: number): T {
  if (!services.length) throw new PlanScheduleError("Add at least one service to the sequence.");
  return services[((visitIndex % services.length) + services.length) % services.length];
}

export function projectScheduleDates(rule: PlanScheduleRule, fallbackStart: string, fallbackEnd: string): string[] {
  const start = rule.windowStart || fallbackStart;
  const end = rule.windowEnd || fallbackEnd;
  if (rule.mode === "fixed_count") {
    return distributedWindowDates(start, end, rule.visitCount ?? 1);
  }
  if (rule.mode === "interval") {
    return intervalDates(start, end, rule.intervalWeeks ?? 1);
  }
  return [];
}

export function normalizePlanSchedule(input: unknown): PlanScheduleRule | null {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new PlanScheduleError("Schedule rule must be an object.");
  const value = input as Record<string, unknown>;
  const mode = value.mode;
  if (mode !== "interval" && mode !== "fixed_count" && mode !== "weekly" && mode !== "monthly" && mode !== "custom") {
    throw new PlanScheduleError("Choose interval, fixed-count, weekly, monthly, or custom scheduling.");
  }
  const rule: PlanScheduleRule = { mode };
  if (mode === "interval") {
    const weeks = Number(value.intervalWeeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new PlanScheduleError("Interval frequency needs a whole number of weeks from 1 to 52.");
    rule.intervalWeeks = weeks;
  }
  if (mode === "fixed_count") {
    const count = Number(value.visitCount);
    if (!Number.isInteger(count) || count < 2 || count > 366) throw new PlanScheduleError("A fixed-count window needs between 2 and 366 services.");
    rule.visitCount = count;
  }
  for (const field of ["windowStart", "windowEnd"] as const) {
    if (value[field] == null || value[field] === "") continue;
    if (typeof value[field] !== "string") throw new PlanScheduleError("Window dates must be YYYY-MM-DD.");
    parseKey(value[field]);
    rule[field] = value[field];
  }
  if (rule.windowStart && rule.windowEnd && rule.windowStart > rule.windowEnd) {
    throw new PlanScheduleError("The window end must be on or after the window start.");
  }
  if (mode === "fixed_count" && rule.windowStart && rule.windowEnd) {
    distributedWindowDates(rule.windowStart, rule.windowEnd, rule.visitCount!);
  }
  return rule;
}

export function sequenceServices(services: unknown): SequencedService[] {
  if (!Array.isArray(services) || services.length === 0) throw new PlanScheduleError("Add at least one service.");
  return services.map((raw, index) => {
    const row = raw as Record<string, unknown>;
    const serviceId = Number(row.serviceId);
    const frequencyDays = Number(row.frequencyDays);
    if (!Number.isSafeInteger(serviceId) || serviceId <= 0) throw new PlanScheduleError("Each sequenced service needs a valid service.");
    if (!Number.isFinite(frequencyDays) || frequencyDays <= 0) throw new PlanScheduleError("Each service needs a positive recurrence.");
    const sequence = row.sequence == null ? index + 1 : Number(row.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) throw new PlanScheduleError("Service order must be a positive whole number.");
    return {
      serviceId,
      serviceName: typeof row.serviceName === "string" ? row.serviceName : "",
      frequencyDays,
      sequence,
    };
  }).sort((a, b) => a.sequence - b.sequence).map((service, index) => ({ ...service, sequence: index + 1 }));
}
