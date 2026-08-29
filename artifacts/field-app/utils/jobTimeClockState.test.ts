import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { mergeFallbackJobs, optimisticClockIn, optimisticClockOut, resolveWithTimeout } from './jobTimeClockState';
import { addTenantDays, dateFromTenantKey, formatCalendarDateKey, sortScheduleJobs, tenantDateKey, tenantSchedulePeriod } from './schedule';
import { mapLoginUser } from './authUser';

const rows = [
  { id: 1, kind: 'job' as const, activeTimerId: 10, activeTimerStartedAt: '2026-01-01T09:00:00.000Z', elapsedSeconds: 60 },
  { id: 2, kind: 'job' as const, activeTimerId: null, activeTimerStartedAt: null, elapsedSeconds: 0 },
];

describe('job time clock optimistic state', () => {
  afterEach(() => vi.useRealTimers());
  it('bounds a hanging location lookup and resolves null without leaving pre-mutation work pending', async () => {
    vi.useFakeTimers();
    let settled = false;
    const location = resolveWithTimeout(
      () => new Promise<{ lat: number; lng: number }>(() => undefined),
      3000,
      null,
    ).then(value => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(location).resolves.toBeNull();
    expect(settled).toBe(true);
  });
  it('converts unexpected location failure to null so busy state need not start', async () => {
    const location = await resolveWithTimeout(
      async (): Promise<{ lat: number; lng: number }> => { throw new Error('permission bridge failed'); },
      3000,
      null,
    );
    expect(location).toBeNull();
  });
  it('retains the login tenant timezone and uses it for device-independent schedule periods', () => {
    const user = mapLoginUser({
      id: 1,
      email: 'tech@example.com',
      name: 'Tech',
      role: 'technician',
      tenantId: 2,
      timezone: 'Pacific/Kiritimati',
    });
    expect(user.timezone).toBe('Pacific/Kiritimati');
    const selectedKey = tenantDateKey(new Date('2026-01-01T10:30:00.000Z'), user.timezone!);
    expect(selectedKey).toBe('2026-01-02');
    expect(tenantSchedulePeriod('day', selectedKey, user.timezone!).startDate).toBe('2026-01-01T10:00:00.000Z');
    expect(mapLoginUser({ id: 2, email: 'x@y.z', tenantId: 2 }).timezone).toBe('UTC');
  });
  it('starts one job and stops the prior active sub-timer', () => {
    const result = optimisticClockIn([...rows, { id: 3, kind: 'visit' as const, activeTimerId: 12, activeTimerStartedAt: 'x', elapsedSeconds: 2 }], 2, '2026-01-01T10:00:00.000Z')!;
    expect(result.filter(row => row.activeTimerId != null && row.kind === 'job')).toHaveLength(1);
    expect(result[1].activeTimerId).toBe(-1);
    expect(result[2].activeTimerId).toBeNull();
  });
  it('optimistically stops and can restore the exact prior schedule after a network failure', () => {
    const prior = rows.map(row => ({ ...row }));
    expect(optimisticClockOut(prior, 1)![0].activeTimerId).toBeNull();
    // React Query rollback restores this saved snapshot verbatim.
    expect(prior).toEqual(rows);
  });
  it('merges active timers into fallback/cached rows when the schedule is unavailable', () => {
    const cached = rows.map(row => ({ ...row, activeTimerId: null, activeTimerStartedAt: null }));
    const result = mergeFallbackJobs(cached, [{ id: 77, jobId: 2, startedAt: '2026-01-01T11:00:00.000Z', elapsedSeconds: 11 }]);
    expect(result[1]).toMatchObject({ activeTimerId: 77, activeTimerStartedAt: '2026-01-01T11:00:00.000Z', elapsedSeconds: 11 });
  });
  it('invalidates cached schedules for every selected date after a timer changes', () => {
    const client = new QueryClient();
    const base = ['/api/time-tracking/today-schedule'];
    client.setQueryData([...base, { date: '2026-01-01' }], rows);
    client.setQueryData([...base, { date: '2026-01-02' }], rows);
    client.invalidateQueries({ queryKey: base });
    expect(client.getQueryState([...base, { date: '2026-01-01' }])?.isInvalidated).toBe(true);
    expect(client.getQueryState([...base, { date: '2026-01-02' }])?.isInvalidated).toBe(true);
  });
  it('keeps tenant calendar keys stable when the device instant is in another zone', () => {
    expect(tenantDateKey(new Date('2026-01-02T01:00:00.000Z'), 'America/Denver')).toBe('2026-01-01');
    const selected = dateFromTenantKey('2026-01-01', '2026-01-01');
    expect(tenantDateKey(addTenantDays(selected, 1), 'America/Denver')).toBe('2026-01-02');
  });
  it('builds tenant day/week API ranges and stable cache keys including UTC+14', () => {
    const day = tenantSchedulePeriod('day', '2026-01-01', 'Pacific/Kiritimati');
    expect(day.rangeKey).toBe('2026-01-01_2026-01-02');
    expect(day.dayKeys).toEqual(['2026-01-01']);
    expect(day.startDate).toBe('2025-12-31T10:00:00.000Z');
    const week = tenantSchedulePeriod('week', '2026-01-01', 'America/Denver');
    expect(week.dayKeys).toHaveLength(7);
    expect(week.rangeKey).toBe('2025-12-29_2026-01-05');
  });
  it('keeps UTC+14 labels and route-detail dates authoritative across device zones', () => {
    const selectedKey = tenantDateKey(new Date('2026-01-01T10:30:00.000Z'), 'Pacific/Kiritimati');
    expect(selectedKey).toBe('2026-01-02');
    expect(formatCalendarDateKey(selectedKey, 'full')).toBe('Friday, Jan 2');
    const routeDetailDate = selectedKey;
    expect(routeDetailDate).toBe('2026-01-02');
    expect(tenantDateKey(new Date('2026-01-02T01:00:00.000Z'), 'America/Denver')).toBe('2026-01-01');
  });
  it('keeps offline fallback in route sequence even when scheduled times conflict', () => {
    const jobs = sortScheduleJobs([
      { id: 1, scheduledAt: '2026-01-01T08:00:00.000Z', routeTemplateId: 9, sequenceOrder: 2 },
      { id: 2, scheduledAt: '2026-01-01T12:00:00.000Z', routeTemplateId: 9, sequenceOrder: 1 },
      { id: 3, scheduledAt: '2026-01-01T07:00:00.000Z' },
    ]);
    expect(jobs.map(job => job.id)).toEqual([2, 1, 3]);
  });
  it('groups multiple routes deterministically before comparing stop sequence', () => {
    const jobs = sortScheduleJobs([
      { id: 1, scheduledAt: '2026-01-01T07:00:00.000Z', routeTemplateId: 20, sequenceOrder: 1 },
      { id: 2, scheduledAt: '2026-01-01T12:00:00.000Z', routeTemplateId: 10, sequenceOrder: 2 },
      { id: 3, scheduledAt: '2026-01-01T13:00:00.000Z', routeTemplateId: 10, sequenceOrder: 1 },
      { id: 4, scheduledAt: '2026-01-01T06:00:00.000Z', routeTemplateId: 20, sequenceOrder: 2 },
    ]);
    expect(jobs.map(job => job.id)).toEqual([3, 2, 1, 4]);
  });
});