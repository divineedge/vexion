import { addDays, isSameDay, startOfDay } from 'date-fns';

/** Waitlist rows are unscheduled work. Their scheduled_at value is only a placeholder. */
export function isWaitlistJob(status: string | null | undefined): boolean {
  return status === 'waitlist';
}

/**
 * A dated job belongs on the calendar day of its scheduled time.
 * A waitlist job stays off that day even when scheduled_at is set.
 */
export function jobOnCalendarDay(
  job: { status?: string | null; scheduledAt?: string | null },
  day: Date,
): boolean {
  if (isWaitlistJob(job.status) || !job.scheduledAt) return false;
  const when = new Date(job.scheduledAt);
  return !Number.isNaN(when.getTime()) && isSameDay(when, day);
}

/**
 * List /jobs treats endDate as exclusive. Pass the next local midnight after
 * the last visible calendar day so the whole day is included.
 */
export function exclusiveScheduleRangeEnd(lastVisibleDay: Date): Date {
  return addDays(startOfDay(lastVisibleDay), 1);
}

/** A crew's working day when none is set, and the company day when there is no crew. */
export const DEFAULT_DAY_BUDGET_MINUTES = 480;

export function dayBudgetMinutes(
  crews: { name: string; dailyCapacityMinutes?: number | null }[],
  crewFilter: string,
): number {
  const selected = crewFilter === 'all' ? crews : crews.filter(crew => crew.name === crewFilter);
  if (selected.length === 0) return DEFAULT_DAY_BUDGET_MINUTES;
  return selected.reduce((sum, crew) => {
    const minutes = Number(crew.dailyCapacityMinutes);
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_DAY_BUDGET_MINUTES);
  }, 0);
}

/** Scheduled time is the jobs on that calendar day. Waitlist and cancelled work do not consume it. */
export function dayScheduleHours(
  jobs: { status?: string | null; estimatedDuration?: number | null }[],
  budgetMinutes: number,
): { budgetHours: number; scheduledHours: number; openHours: number } {
  const scheduledMinutes = jobs.reduce((sum, job) => {
    if (isWaitlistJob(job.status) || job.status === 'cancelled') return sum;
    const minutes = Number(job.estimatedDuration);
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
  const budgetHours = budgetMinutes / 60;
  const scheduledHours = scheduledMinutes / 60;
  return { budgetHours, scheduledHours, openHours: budgetHours - scheduledHours };
}

export function formatScheduleHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
