// Pure helpers for the schedule planning forecast. No device-timezone math:
// forecast times arrive already in the tenant/property local timezone.

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};

export function wmoDescription(code: number | null | undefined): string {
  if (code === null || code === undefined || !Number.isFinite(code)) return 'Unavailable';
  return WMO[code] ?? `Code ${code}`;
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassDirection(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '—';
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return DIRS[idx];
}

/** Format a nullable number; null/undefined becomes an em dash (never 0). */
export function fmtNum(v: number | null | undefined, digits = 0, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

export function isKnown(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** "2025-05-03" -> local Date at midnight (for calendar navigation only). */
export function dateKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today's date key in a given IANA timezone. */
export function todayKeyInZone(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return dateKeyOf(now);
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateKey(key: string): { weekday: string; monthDay: string } {
  const d = dateKeyToLocalDate(key);
  if (Number.isNaN(d.getTime())) return { weekday: '—', monthDay: key };
  return { weekday: WEEKDAYS[d.getDay()], monthDay: `${MONTHS[d.getMonth()]} ${d.getDate()}` };
}

/** Hour label from a local ISO-ish string ("2025-05-03T14:00") without device tz conversion. */
export function hourLabel(time: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Pick the pinned property whose job date is nearest to the reference date. */
export function pickDefaultPropertyId(
  jobs: { propertyId?: number | null; scheduledAt: string }[],
  pinnedIds: Set<number>,
  ref: Date,
): number | null {
  let best: { id: number; dist: number } | null = null;
  for (const j of jobs) {
    if (!j.propertyId || !pinnedIds.has(j.propertyId)) continue;
    const dist = Math.abs(new Date(j.scheduledAt).getTime() - ref.getTime());
    if (!Number.isFinite(dist)) continue;
    if (!best || dist < best.dist) best = { id: j.propertyId, dist };
  }
  return best?.id ?? null;
}
