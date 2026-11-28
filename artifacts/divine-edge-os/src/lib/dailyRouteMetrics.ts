export type BoardRole = "crew" | "manager" | "office" | "owner";

export interface MetricJob {
  id: number;
  status: string;
  payout: number;
  callbackDeduction: number;
  isCallback: boolean;
  estimatedMinutes: number;
  actualMinutes: number | null;
  clockInAt: string | null;
}

export interface MetricLeg {
  toId: number | null;
  durationMinutes: number;
  distanceMiles?: number;
}

export function capabilitiesFor(role: BoardRole) {
  const office = role === "office" || role === "owner";
  const dispatchLead = office || role === "manager";
  return {
    switchViews: role !== "crew",
    dispatch: role !== "crew",
    reassign: office,
    logCallback: dispatchLead,
    optimizeAll: dispatchLead,
    optimizeRoute: true,
    lockToggle: role !== "crew",
    simulateRole: office,
  };
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatHourly(amount: number): string {
  return `${formatMoney(amount)} / hr`;
}

/** h:mm A, for example 3:42 PM. */
export function formatEta(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return formatted.replace(/[\s\u202f\u00a0]*(am|pm)$/i, (_match, suffix: string) => ` ${suffix.toUpperCase()}`);
}

export function elapsedMinutes(clockInAt: string | null, now: Date): number {
  if (!clockInAt) return 0;
  const started = new Date(clockInAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((now.getTime() - started) / 60_000));
}

export function routeMoney(jobs: MetricJob[]) {
  const deduction = jobs.reduce((sum, job) => sum + (job.isCallback ? job.callbackDeduction : 0), 0);
  const payout = jobs.reduce((sum, job) => sum + job.payout, 0);
  const earned = jobs.filter(job => job.status === "completed").reduce((sum, job) => sum + job.payout, 0) - deduction;
  return {
    net: payout - deduction,
    deduction,
    earned,
    completed: jobs.filter(job => job.status === "completed").length,
    total: jobs.length,
    jobMinutes: jobs.reduce((sum, job) => sum + job.estimatedMinutes, 0),
  };
}

export function remainingWorkMinutes(jobs: MetricJob[], legs: MetricLeg[], now: Date): number {
  const jobMinutes = jobs.reduce((sum, job) => {
    if (job.status === "completed") return sum;
    if (job.status === "in_progress") return sum + Math.max(0, job.estimatedMinutes - elapsedMinutes(job.clockInAt, now));
    return sum + job.estimatedMinutes;
  }, 0);
  const drive = legs.reduce((sum, leg) => {
    if (leg.toId == null) return sum + leg.durationMinutes;
    const job = jobs.find(item => item.id === leg.toId);
    if (!job || job.status === "completed" || job.status === "in_progress") return sum;
    return sum + leg.durationMinutes;
  }, 0);
  return jobMinutes + drive;
}

export function projectedHourly(net: number, jobMinutes: number, driveMinutes: number): number {
  const hours = (jobMinutes + driveMinutes) / 60;
  return hours > 0 ? net / hours : 0;
}

export function effectiveHourly(input: {
  net: number;
  earned: number;
  jobMinutes: number;
  driveMinutes: number;
  shiftStart: Date;
  now: Date;
}): number {
  const estimatedHours = (input.jobMinutes + input.driveMinutes) / 60;
  if (input.now.getTime() < input.shiftStart.getTime()) {
    return estimatedHours > 0 ? input.net / estimatedHours : 0;
  }
  const elapsedHours = Math.max((input.now.getTime() - input.shiftStart.getTime()) / 3_600_000, 1 / 60);
  return input.earned / elapsedHours;
}

export function completionLabel(job: MetricJob): { tone: "green" | "slate"; text: string } | null {
  if (job.status !== "completed") return null;
  const actual = job.actualMinutes ?? job.estimatedMinutes;
  if (actual <= job.estimatedMinutes) {
    const ahead = job.estimatedMinutes - actual;
    return {
      tone: "green",
      text: ahead > 0 ? `Done in ${actual}m • ${ahead}m ahead` : `Done in ${actual}m • on time`,
    };
  }
  return { tone: "slate", text: `Done in ${actual}m` };
}

export interface PreviewCrew {
  id: number;
  managerId: number | null;
  name: string;
}

export function visibleCrews<T extends PreviewCrew>(input: {
  role: BoardRole;
  viewerId: number;
  realRole: BoardRole;
  crews: T[];
  myCrewIds: number[];
  managers: Array<{ id: number }>;
}): T[] {
  if (input.role === "crew") return input.crews.slice(0, 1);
  if (input.role === "manager") {
    const managerId = input.realRole === "manager" ? input.viewerId : input.managers[0]?.id;
    return input.crews.filter(crew => crew.managerId === managerId || (input.realRole === "manager" && input.myCrewIds.includes(crew.id)));
  }
  return input.crews;
}
