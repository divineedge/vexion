export function minutesFromTimers(timers: Array<{
  startedAt: Date;
  stoppedAt: Date | null;
  elapsedSeconds: number;
  adjustedStartedAt: Date | null;
  adjustedStoppedAt: Date | null;
  isActive: boolean;
}>, asOf: Date): number {
  let seconds = 0;
  for (const timer of timers) {
    const start = timer.adjustedStartedAt ?? timer.startedAt;
    const stop = timer.adjustedStoppedAt ?? timer.stoppedAt ?? (timer.isActive ? asOf : null);
    if (start && stop) seconds += Math.max(0, Math.floor((stop.getTime() - start.getTime()) / 1000));
    else seconds += Math.max(0, timer.elapsedSeconds || 0);
  }
  return seconds / 60;
}

/** 105 minutes is 1.75 hours. A minimum applies only after some time was clocked. */
export function billableHours(workedMinutes: number, minimumMinutes: number | null | undefined): number {
  const worked = Number.isFinite(workedMinutes) && workedMinutes > 0 ? workedMinutes : 0;
  const minimum = typeof minimumMinutes === "number" && Number.isFinite(minimumMinutes) && minimumMinutes > 0 ? minimumMinutes : 0;
  const billed = worked > 0 && minimum > 0 ? Math.max(worked, minimum) : worked;
  return Math.round((billed / 60) * 100) / 100;
}

export function hourlyTotal(hours: number, rate: number): number {
  return Math.round(hours * rate * 100) / 100;
}

export function hourlyLineDescription(name: string, hours: number, rate: number): string {
  return `${name} - ${hours} hrs @ $${rate.toFixed(2)}/hr`;
}
