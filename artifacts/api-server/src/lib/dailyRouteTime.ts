/** Calendar day YYYY-MM-DD in a tenant timezone. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A wall-clock time on `date` in `timeZone`, expressed as a UTC instant.
 * `minutesFromMidnight` is local time, so 420 is 7:00 AM in that zone.
 */
export function zonedDateTime(date: string, minutesFromMidnight: number, timeZone: string): Date {
  const hours = Math.floor(minutesFromMidnight / 60);
  const mins = minutesFromMidnight % 60;
  const wallAsUtc = new Date(`${date}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00Z`);
  const utcWall = new Date(wallAsUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoneWall = new Date(wallAsUtc.toLocaleString("en-US", { timeZone }));
  return new Date(wallAsUtc.getTime() + (utcWall.getTime() - zoneWall.getTime()));
}
