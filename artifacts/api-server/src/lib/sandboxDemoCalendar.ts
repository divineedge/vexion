export const SANDBOX_DEMO_SLUG = "sandbox-demo";
export const SANDBOX_DEMO_EMAIL = "field.demo@sandbox.invalid";
export const SANDBOX_DEMO_TIMEZONE = "America/Denver";
export const SANDBOX_DEMO_SESSION_MS = 12 * 60 * 60 * 1000;

export function tenantDayBounds(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = dateKey.split("-").map(Number);
  const nextKey = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    start: zonedWallTime(dateKey, timeZone),
    end: zonedWallTime(nextKey, timeZone),
  };
}

function zonedWallTime(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const first = zoneOffsetMs(timeZone, new Date(utc));
  utc -= first;
  const second = zoneOffsetMs(timeZone, new Date(utc));
  if (second !== first) utc = Date.UTC(year, month - 1, day, 0, 0, 0) - second;
  return new Date(utc);
}

function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find(part => part.type === type)?.value);
  let hour = pick("hour");
  let day = pick("day");
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, day, hour, pick("minute"), pick("second"));
  return asUtc - date.getTime();
}
