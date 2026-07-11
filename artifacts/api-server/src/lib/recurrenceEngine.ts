/**
 * Recurrence Rule Engine
 * Pure TypeScript utility for computing scheduled dates from a rule.
 *
 * Key design: ALL date computation is deterministic and count-based.
 * nthOccurrenceAfterRoot(rule, rootDate, n) returns the date of the
 * nth occurrence AFTER the root (0 = first child, 1 = second, ...).
 *
 * This means:
 *  - Skipping increments the count, and the scheduler simply picks up at the new count
 *  - The series list uses the same formula as the scheduler
 *  - No state divergence between skip and actual generation
 */

export type RecurrencePattern =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly_date"
  | "monthly_weekday"
  | "custom";

export type EndCondition = "never" | "after" | "on_date";

export interface RecurrenceRule {
  pattern: RecurrencePattern;
  /** Used by custom (days) and biweekly patterns */
  interval?: number;
  /** 0=Sun … 6=Sat; used by weekly and biweekly */
  daysOfWeek?: number[];
  /** 1–31; used by monthly_date */
  dayOfMonth?: number;
  /** 1=first … 5=last; used by monthly_weekday */
  weekOfMonth?: number;
  /** 0=Sun … 6=Sat; used by monthly_weekday */
  dayOfWeek?: number;
  endCondition: EndCondition;
  /** Used when endCondition === "after" */
  endAfter?: number;
  /** ISO date string; used when endCondition === "on_date" */
  endDate?: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDINALS = ["", "first", "second", "third", "fourth", "last"];

/** Returns a human-readable summary of the rule */
export function describeRule(rule: RecurrenceRule): string {
  let freq = "";
  switch (rule.pattern) {
    case "daily":
      freq = "Every day";
      break;
    case "weekly": {
      const days = (rule.daysOfWeek ?? []).map(d => DAY_NAMES[d]).join(" & ");
      freq = days ? `Every ${days}` : "Every week";
      break;
    }
    case "biweekly": {
      const days = (rule.daysOfWeek ?? []).map(d => DAY_NAMES[d]).join(" & ");
      freq = days ? `Every 2 weeks on ${days}` : "Every 2 weeks";
      break;
    }
    case "monthly_date":
      freq = `Monthly on the ${rule.dayOfMonth ?? 1}`;
      break;
    case "monthly_weekday": {
      const ord = ORDINALS[rule.weekOfMonth ?? 1] ?? "first";
      const dow = DAY_NAMES[rule.dayOfWeek ?? 1] ?? "Mon";
      freq = `Monthly on the ${ord} ${dow}`;
      break;
    }
    case "custom":
      freq = `Every ${rule.interval ?? 1} day${(rule.interval ?? 1) !== 1 ? "s" : ""}`;
      break;
  }

  let end = "";
  if (rule.endCondition === "after" && rule.endAfter) {
    end = `, ${rule.endAfter} times`;
  } else if (rule.endCondition === "on_date" && rule.endDate) {
    end = `, until ${rule.endDate.slice(0, 10)}`;
  }

  return freq + end;
}

/**
 * Compute the date of the nth occurrence AFTER rootDate.
 * n=0 → first child occurrence
 * n=1 → second child occurrence
 * etc.
 *
 * Returns null if the series is exhausted at or before n.
 */
export function nthOccurrenceAfterRoot(
  rule: RecurrenceRule,
  rootDate: Date,
  n: number,
): Date | null {
  // Check count-based end condition
  if (rule.endCondition === "after" && rule.endAfter != null) {
    if (n >= rule.endAfter) return null;
  }

  let current = rootDate;
  for (let i = 0; i <= n; i++) {
    const next = stepForward(rule, current);
    if (!next) return null;
    if (i === n) {
      // Check date-based end condition — compare calendar dates only (inclusive of end day).
      // Parsing a date-only string ("YYYY-MM-DD") with `new Date()` gives midnight UTC,
      // which would incorrectly reject occurrences scheduled later that same day.
      // Comparing ISO date substrings avoids this and is timezone-safe.
      if (rule.endCondition === "on_date" && rule.endDate) {
        const nextDateOnly = next.toISOString().slice(0, 10);
        const endDateOnly = rule.endDate.slice(0, 10);
        if (nextDateOnly > endDateOnly) return null;
      }
      return next;
    }
    current = next;
  }
  return null;
}

/** Alias kept for compatibility with the frontend helper */
export function nextOccurrence(
  rule: RecurrenceRule,
  fromDate: Date,
  completedCount: number,
): Date | null {
  return nthOccurrenceAfterRoot(rule, fromDate, completedCount);
}

// ---------------------------------------------------------------------------
// Internal: compute ONE step forward from `from` according to the rule
// ---------------------------------------------------------------------------

function stepForward(rule: RecurrenceRule, from: Date): Date | null {
  switch (rule.pattern) {
    case "daily":
      return addDays(from, 1);

    case "custom":
      return addDays(from, rule.interval ?? 1);

    case "weekly":
    case "biweekly": {
      const weeksInterval = rule.pattern === "biweekly" ? (rule.interval ?? 2) : 1;
      const days = [...(rule.daysOfWeek ?? [])].sort((a, b) => a - b);
      if (days.length === 0) return addDays(from, 7 * weeksInterval);

      const fromDow = from.getDay();
      // Next matching day within the same week (strictly after fromDow)
      const nextInWeek = days.find(d => d > fromDow);
      if (nextInWeek != null) {
        return addDays(from, nextInWeek - fromDow);
      }
      // Wrap: advance to the first matching day in the next interval's week
      const daysUntilFirst = (7 * weeksInterval) - fromDow + days[0];
      return addDays(from, daysUntilFirst);
    }

    case "monthly_date": {
      const target = rule.dayOfMonth ?? 1;
      // Set to 1st of current month first to avoid overflow (e.g. Jan 31 + 1 month = Mar 3)
      const next = new Date(from);
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      // Clamp to the actual number of days in target month
      next.setDate(Math.min(target, daysInMonth(next.getFullYear(), next.getMonth())));
      return next;
    }

    case "monthly_weekday": {
      const weekOfMonth = rule.weekOfMonth ?? 1;
      const dow = rule.dayOfWeek ?? 1;
      const next = new Date(from);
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      return nthWeekdayOfMonth(next.getFullYear(), next.getMonth(), dow, weekOfMonth);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add N calendar days, preserving wall-clock time */
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function daysInMonth(year: number, month: number): number {
  // month is 0-indexed (same as Date)
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Returns the nth occurrence of dayOfWeek (0=Sun…6=Sat) in the given year/month.
 * weekNum: 1=first, 2=second … 5=last
 */
function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, weekNum: number): Date {
  if (weekNum === 5) {
    // last occurrence
    const lastDay = new Date(year, month + 1, 0);
    const lastDow = lastDay.getDay();
    const diff = (lastDow - dayOfWeek + 7) % 7;
    const d = new Date(lastDay);
    d.setDate(lastDay.getDate() - diff);
    return d;
  }

  const first = new Date(year, month, 1);
  const firstDow = first.getDay();
  const offset = (dayOfWeek - firstDow + 7) % 7;
  const day = 1 + offset + (weekNum - 1) * 7;
  return new Date(year, month, day);
}

/**
 * Generate the next N occurrence dates from a rule.
 * startingCount is the recurrenceCount on the root (0 = nothing generated yet).
 */
export function nextNOccurrences(
  rule: RecurrenceRule,
  rootDate: Date,
  startingCount: number,
  n: number,
): Date[] {
  const results: Date[] = [];
  for (let i = 0; i < n; i++) {
    const d = nthOccurrenceAfterRoot(rule, rootDate, startingCount + i);
    if (!d) break;
    results.push(d);
  }
  return results;
}
