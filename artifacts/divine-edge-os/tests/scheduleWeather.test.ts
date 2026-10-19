import { describe, it, expect } from 'vitest';
import { wmoDescription, compassDirection, fmtNum, formatDateKey, hourLabel, pickDefaultPropertyId, todayKeyInZone } from '../src/lib/scheduleWeather';

describe('schedule weather helpers', () => {
  it('describes WMO codes and nulls', () => {
    expect(wmoDescription(0)).toBe('Clear');
    expect(wmoDescription(95)).toBe('Thunderstorm');
    expect(wmoDescription(null)).toBe('Unavailable');
    expect(wmoDescription(42)).toBe('Code 42');
  });
  it('maps compass directions', () => {
    expect(compassDirection(0)).toBe('N');
    expect(compassDirection(359)).toBe('N');
    expect(compassDirection(90)).toBe('E');
    expect(compassDirection(225)).toBe('SW');
    expect(compassDirection(null)).toBe('—');
  });
  it('never renders null as zero', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(0.123, 2, '"')).toBe('0.12"');
  });
  it('formats dates and hours without device tz shifts', () => {
    expect(formatDateKey('2025-05-03')).toEqual({ weekday: 'Sat', monthDay: 'May 3' });
    expect(hourLabel('2025-05-03T00:00')).toBe('12:00 AM');
    expect(hourLabel('2025-05-03T14:00')).toBe('2:00 PM');
    expect(todayKeyInZone('America/Chicago', new Date('2025-05-03T03:00:00Z'))).toBe('2025-05-02');
  });
  it('picks nearest pinned property', () => {
    const jobs = [
      { propertyId: 1, scheduledAt: '2025-05-10T10:00:00Z' },
      { propertyId: 2, scheduledAt: '2025-05-04T10:00:00Z' },
      { propertyId: 3, scheduledAt: '2025-05-03T10:00:00Z' },
    ];
    expect(pickDefaultPropertyId(jobs, new Set([1, 2]), new Date('2025-05-03T00:00:00Z'))).toBe(2);
    expect(pickDefaultPropertyId(jobs, new Set(), new Date())).toBeNull();
  });
});
