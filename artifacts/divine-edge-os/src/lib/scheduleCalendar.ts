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
