/** Mirrors the API date math used when a plan template is sold. */

function parseKey(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

function keyFrom(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export function distributedWindowDates(start: string, end: string, count: number): string[] {
  const startMs = parseKey(start);
  const endMs = parseKey(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || count < 2) return [];
  const span = Math.round((endMs - startMs) / 86_400_000);
  if (span < count - 1) return [];
  const used = new Set<number>();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    let offset = i === 0 ? 0 : i === count - 1 ? span : Math.round((span * i) / (count - 1));
    while (used.has(offset) && offset < span) offset += 1;
    used.add(offset);
    offsets.push(offset);
  }
  return offsets.map(offset => keyFrom(startMs + offset * 86_400_000));
}

export function intervalDates(start: string, end: string, weeks: number): string[] {
  const endMs = parseKey(end);
  if (!Number.isFinite(parseKey(start)) || !Number.isFinite(endMs) || weeks < 1) return [];
  const dates: string[] = [];
  let cursor = parseKey(start);
  while (cursor <= endMs && dates.length < 366) {
    dates.push(keyFrom(cursor));
    cursor += weeks * 7 * 86_400_000;
  }
  return dates;
}

export function ordinal(index: number): string {
  const n = index + 1;
  const mod = n % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
