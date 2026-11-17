/** Pure aggregation for the Clocked Time report. Job clock-ins and shop-task timers in, hours and cost out. */

export interface ClockSlice {
  userId: number;
  userName: string;
  /** Null when the employee has no pay rate on file. Those hours cost $0. */
  hourlyRate: number | null;
  startedAt: string;
  /** Null means the timer is still open and runs through `asOf`. */
  endedAt: string | null;
  isJob: boolean;
  serviceName: string | null;
  taskType: string | null;
  taskLabel: string | null;
  jobId: number | null;
  /** Scheduled job duration in minutes. Null when the job has no estimate. */
  estimatedMinutes: number | null;
}

export interface ClockedTimeRow {
  key: string;
  name: string;
  kind: "service" | "task";
  minutes: number;
  hoursLabel: string;
  decimalHours: number;
  percentOfTotal: number;
  budgetedMinutes: number | null;
  budgetedHours: number | null;
  varianceHours: number | null;
  laborCost: number;
}

export interface ClockedEmployee {
  userId: number;
  userName: string;
  hourlyRate: number | null;
  minutes: number;
  hoursLabel: string;
  decimalHours: number;
  percentOfTotal: number;
  laborCost: number;
  rows: ClockedTimeRow[];
}

export interface ClockedTimeReport {
  totalMinutes: number;
  totalHoursLabel: string;
  totalDecimalHours: number;
  totalLaborCost: number;
  services: ClockedTimeRow[];
  tasks: ClockedTimeRow[];
  employees: ClockedEmployee[];
}

export const SHOP_TASKS = [
  { key: "travel", name: "Travel/Drive Time" },
  { key: "shop", name: "Shop Maintenance" },
  { key: "equipment", name: "Equipment Prep" },
  { key: "meetings", name: "Meetings" },
] as const;

const TASK_MATCHERS: { key: string; name: string; test: RegExp }[] = [
  { key: "travel", name: "Travel/Drive Time", test: /travel|drive/i },
  { key: "shop", name: "Shop Maintenance", test: /shop|maintenance/i },
  { key: "equipment", name: "Equipment Prep", test: /equip|prep|loadout|load/i },
  { key: "meetings", name: "Meetings", test: /meet/i },
];

export function formatClockedHours(minutes: number): { hoursLabel: string; decimalHours: number } {
  const rounded = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return {
    hoursLabel: `${hours}:${String(mins).padStart(2, "0")}`,
    decimalHours: Math.round((rounded / 60) * 100) / 100,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanLabel(label: string | null): string {
  if (!label) return "";
  const visit = label.match(/^visit:\d+:(.*)$/i);
  return (visit?.[1] ?? label).trim();
}

export function classifyTask(type: string | null, label: string | null): { key: string; name: string } {
  const haystack = `${type ?? ""} ${cleanLabel(label)}`;
  for (const task of TASK_MATCHERS) {
    if (task.test.test(haystack)) return { key: task.key, name: task.name };
  }
  const name = cleanLabel(label) || (type ?? "").trim() || "Other";
  return { key: `other:${name.toLowerCase()}`, name };
}

export function overlapMinutes(slice: ClockSlice, rangeStart: Date, rangeEnd: Date, asOf: Date): number {
  const start = new Date(slice.startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const rawEnd = slice.endedAt ? new Date(slice.endedAt).getTime() : asOf.getTime();
  if (!Number.isFinite(rawEnd)) return 0;
  const from = Math.max(start, rangeStart.getTime());
  const to = Math.min(rawEnd, rangeEnd.getTime());
  if (to <= from) return 0;
  return (to - from) / 60000;
}

interface Bucket {
  key: string;
  name: string;
  kind: "service" | "task";
  minutes: number;
  laborCost: number;
  jobs: Map<number, { estimated: number | null; minutes: number; userMinutes: Map<number, number> }>;
}

function emptyBucket(key: string, name: string, kind: "service" | "task"): Bucket {
  return { key, name, kind, minutes: 0, laborCost: 0, jobs: new Map() };
}

function serviceKey(slice: ClockSlice): { key: string; name: string } {
  const name = (slice.serviceName ?? "").trim() || "Unassigned service";
  return { key: `service:${name.toLowerCase()}`, name };
}

function budgetedMinutes(bucket: Bucket, userId?: number): number | null {
  let estimated = 0;
  let any = false;
  for (const job of bucket.jobs.values()) {
    if (job.estimated == null || !(job.minutes > 0)) continue;
    any = true;
    if (userId == null) estimated += job.estimated;
    else estimated += job.estimated * ((job.userMinutes.get(userId) ?? 0) / job.minutes);
  }
  return any ? estimated : null;
}

function toRow(bucket: Bucket, totalMinutes: number, userId?: number): ClockedTimeRow {
  const display = formatClockedHours(bucket.minutes);
  const budgetMinutes = bucket.kind === "service" ? budgetedMinutes(bucket, userId) : null;
  const budgetedHours = budgetMinutes == null ? null : formatClockedHours(budgetMinutes).decimalHours;
  const percent = totalMinutes > 0 ? round2((Math.round(bucket.minutes) / Math.round(totalMinutes)) * 100) : 0;
  return {
    key: bucket.key,
    name: bucket.name,
    kind: bucket.kind,
    minutes: bucket.minutes,
    hoursLabel: display.hoursLabel,
    decimalHours: display.decimalHours,
    percentOfTotal: percent,
    budgetedMinutes: budgetMinutes,
    budgetedHours,
    varianceHours: budgetedHours == null ? null : round2(display.decimalHours - budgetedHours),
    laborCost: round2(bucket.laborCost),
  };
}

export function aggregateClockedTime(
  slices: ClockSlice[],
  range: { start: Date; end: Date; asOf: Date },
): ClockedTimeReport {
  const company = new Map<string, Bucket>();
  for (const task of SHOP_TASKS) company.set(task.key, emptyBucket(task.key, task.name, "task"));
  const byUser = new Map<number, { name: string; rate: number | null; buckets: Map<string, Bucket>; minutes: number; laborCost: number }>();

  for (const slice of slices) {
    const minutes = overlapMinutes(slice, range.start, range.end, range.asOf);
    if (!(minutes > 0)) continue;
    const rate = slice.hourlyRate != null && Number.isFinite(slice.hourlyRate) && slice.hourlyRate > 0 ? slice.hourlyRate : 0;
    const cost = (minutes / 60) * rate;
    const identity = slice.isJob ? serviceKey(slice) : classifyTask(slice.taskType, slice.taskLabel);
    const kind = slice.isJob ? "service" : "task";
    const companyBucket = company.get(identity.key) ?? emptyBucket(identity.key, identity.name, kind);
    companyBucket.minutes += minutes;
    companyBucket.laborCost += cost;
    if (slice.isJob && slice.jobId != null) {
      const job = companyBucket.jobs.get(slice.jobId) ?? { estimated: slice.estimatedMinutes, minutes: 0, userMinutes: new Map() };
      if (job.estimated == null && slice.estimatedMinutes != null) job.estimated = slice.estimatedMinutes;
      job.minutes += minutes;
      job.userMinutes.set(slice.userId, (job.userMinutes.get(slice.userId) ?? 0) + minutes);
      companyBucket.jobs.set(slice.jobId, job);
    }
    company.set(identity.key, companyBucket);

    const user = byUser.get(slice.userId) ?? { name: slice.userName || `Employee ${slice.userId}`, rate: slice.hourlyRate, buckets: new Map(), minutes: 0, laborCost: 0 };
    const userBucket = user.buckets.get(identity.key) ?? emptyBucket(identity.key, identity.name, kind);
    userBucket.minutes += minutes;
    userBucket.laborCost += cost;
    if (slice.isJob && slice.jobId != null) {
      const shared = companyBucket.jobs.get(slice.jobId);
      if (shared) userBucket.jobs.set(slice.jobId, shared);
    }
    user.buckets.set(identity.key, userBucket);
    user.minutes += minutes;
    user.laborCost += cost;
    byUser.set(slice.userId, user);
  }

  const totalMinutes = [...company.values()].reduce((sum, bucket) => sum + bucket.minutes, 0);
  const totalDisplay = formatClockedHours(totalMinutes);
  const services = [...company.values()].filter(bucket => bucket.kind === "service" && bucket.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    .map(bucket => toRow(bucket, totalMinutes));
  const taskOrder = new Map<string, number>(SHOP_TASKS.map((task, index) => [task.key, index]));
  const tasks = [...company.values()].filter(bucket => bucket.kind === "task" && (taskOrder.has(bucket.key) || bucket.minutes > 0))
    .sort((a, b) => (taskOrder.get(a.key) ?? 100) - (taskOrder.get(b.key) ?? 100) || b.minutes - a.minutes || a.name.localeCompare(b.name))
    .map(bucket => toRow(bucket, totalMinutes));
  const employees = [...byUser.entries()]
    .map(([userId, user]) => {
      const display = formatClockedHours(user.minutes);
      const rows = [...user.buckets.values()]
        .filter(bucket => bucket.minutes > 0)
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "service" ? -1 : 1) || b.minutes - a.minutes || a.name.localeCompare(b.name))
        .map(bucket => toRow(bucket, user.minutes, userId));
      return {
        userId,
        userName: user.name,
        hourlyRate: user.rate,
        minutes: user.minutes,
        hoursLabel: display.hoursLabel,
        decimalHours: display.decimalHours,
        percentOfTotal: totalMinutes > 0 ? round2((Math.round(user.minutes) / Math.round(totalMinutes)) * 100) : 0,
        laborCost: round2(user.laborCost),
        rows,
      };
    })
    .sort((a, b) => a.userName.localeCompare(b.userName) || a.userId - b.userId);

  return {
    totalMinutes,
    totalHoursLabel: totalDisplay.hoursLabel,
    totalDecimalHours: totalDisplay.decimalHours,
    totalLaborCost: round2(employees.reduce((sum, employee) => sum + employee.laborCost, 0)),
    services,
    tasks,
    employees,
  };
}
