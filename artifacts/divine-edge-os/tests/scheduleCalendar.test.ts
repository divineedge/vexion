import { describe, expect, it } from 'vitest';
import { dayBudgetMinutes, dayScheduleHours, exclusiveScheduleRangeEnd, formatScheduleHours, jobOnCalendarDay } from '../src/lib/scheduleCalendar';

describe('schedule calendar placement', () => {
  const thursday = new Date(2026, 10, 26, 0, 0, 0, 0);
  const thursdayMorning = new Date(2026, 10, 26, 9, 0, 0).toISOString();
  const fridayMorning = new Date(2026, 10, 27, 9, 0, 0).toISOString();

  it('places a dated job on the day it was scheduled', () => {
    expect(jobOnCalendarDay({ status: 'scheduled', scheduledAt: thursdayMorning }, thursday)).toBe(true);
    expect(jobOnCalendarDay({ status: 'in_progress', scheduledAt: thursdayMorning }, thursday)).toBe(true);
    expect(jobOnCalendarDay({ status: 'scheduled', scheduledAt: fridayMorning }, thursday)).toBe(false);
  });

  it('keeps a waitlist job off the calendar day of its placeholder time', () => {
    expect(jobOnCalendarDay({ status: 'waitlist', scheduledAt: thursdayMorning }, thursday)).toBe(false);
    expect(jobOnCalendarDay({ status: 'waitlist', scheduledAt: null }, thursday)).toBe(false);
  });

  it('turns a 90-minute job into 1.5 scheduled hours and the remaining open time', () => {
    const hours = dayScheduleHours(
      [
        { status: 'scheduled', estimatedDuration: 90 },
        { status: 'waitlist', estimatedDuration: 120 },
        { status: 'cancelled', estimatedDuration: 60 },
      ],
      480,
    );
    expect(hours.budgetHours).toBe(8);
    expect(hours.scheduledHours).toBe(1.5);
    expect(hours.openHours).toBe(6.5);
    expect(formatScheduleHours(hours.scheduledHours)).toBe('1.5');
    expect(formatScheduleHours(hours.openHours)).toBe('6.5');
  });

  it('uses each crew day as the budget and keeps the default when no crew is selected', () => {
    const crews = [
      { name: 'North', dailyCapacityMinutes: 480 },
      { name: 'South', dailyCapacityMinutes: 360 },
    ];
    expect(dayBudgetMinutes(crews, 'all')).toBe(840);
    expect(dayBudgetMinutes(crews, 'South')).toBe(360);
    expect(dayBudgetMinutes([], 'all')).toBe(480);
  });

  it('uses the next local midnight as the exclusive range end', () => {
    const end = exclusiveScheduleRangeEnd(new Date(2026, 10, 29, 23, 59, 59, 999));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(10);
    expect(end.getDate()).toBe(30);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
  });
});
