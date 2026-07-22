/**
 * Off-season utility helpers.
 *
 * Off-season windows are stored as "MM-DD" strings (e.g. "11-15", "03-14").
 * The window may wrap across a year boundary (e.g. Nov 15 → Mar 14).
 */

/** Returns the "MM-DD" representation of a Date (UTC). */
function toMMDD(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${m}-${d}`;
}

/**
 * Returns true if the given date falls within the service's off-season window.
 * Both start and end must be non-null "MM-DD" strings for a window to apply.
 */
export function isInOffSeason(
  date: Date,
  offSeasonStart: string | null | undefined,
  offSeasonEnd: string | null | undefined,
): boolean {
  if (!offSeasonStart || !offSeasonEnd) return false;
  const mmdd = toMMDD(date);
  if (offSeasonStart <= offSeasonEnd) {
    // Same-calendar-year window (e.g. "06-01" → "08-31")
    return mmdd >= offSeasonStart && mmdd <= offSeasonEnd;
  } else {
    // Wraps year boundary (e.g. "11-15" → "03-14")
    return mmdd >= offSeasonStart || mmdd <= offSeasonEnd;
  }
}

/**
 * Given a date that is inside the off-season, returns the first UTC date
 * (midnight) that falls after the off-season end.
 *
 * @param referenceDate - A date known to be within the off-season window.
 * @param offSeasonEnd  - "MM-DD" of the last off-season day.
 */
export function firstDayAfterOffSeason(referenceDate: Date, offSeasonEnd: string): Date {
  const [endMonthStr, endDayStr] = offSeasonEnd.split("-");
  const endMonth = parseInt(endMonthStr, 10);
  const endDay = parseInt(endDayStr, 10);
  const year = referenceDate.getUTCFullYear();

  // Day after end: using month/day+1 — the Date constructor normalises overflow
  // (e.g. month=3, day=32 becomes April 1).
  const thisYearCandidate = new Date(Date.UTC(year, endMonth - 1, endDay + 1));
  if (thisYearCandidate > referenceDate) return thisYearCandidate;

  // If this-year candidate is already past, use next year.
  return new Date(Date.UTC(year + 1, endMonth - 1, endDay + 1));
}

/**
 * Format a "MM-DD" string like "11-15" into a human-readable label
 * such as "Nov 15".
 */
export function formatMMDD(mmdd: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [mm, dd] = mmdd.split("-");
  const monthLabel = months[parseInt(mm, 10) - 1] ?? mm;
  return `${monthLabel} ${parseInt(dd, 10)}`;
}
