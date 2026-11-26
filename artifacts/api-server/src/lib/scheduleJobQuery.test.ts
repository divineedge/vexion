import { describe, expect, it } from 'vitest';
import { scheduleRangeOmitsWaitlist } from './scheduleJobQuery';

describe('schedule job list', () => {
  it('omits waitlist from a date range when no status was requested', () => {
    expect(scheduleRangeOmitsWaitlist(undefined, true)).toBe(true);
    expect(scheduleRangeOmitsWaitlist('', true)).toBe(true);
  });

  it('keeps an explicit waitlist query and undated lists intact', () => {
    expect(scheduleRangeOmitsWaitlist('waitlist', true)).toBe(false);
    expect(scheduleRangeOmitsWaitlist('scheduled', true)).toBe(false);
    expect(scheduleRangeOmitsWaitlist(undefined, false)).toBe(false);
  });
});
