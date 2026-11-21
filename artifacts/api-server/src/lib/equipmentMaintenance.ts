export type MaintenanceInterval = { label: string; everyHours: number };
export type CategoryThreshold = {
  category: string;
  warnHours?: number | null;
  retireHours?: number | null;
  repairPct?: number | null;
  resalePct?: number | null;
  intervals?: MaintenanceInterval[];
};

export function thresholdFor(category: string, rules: CategoryThreshold[]): CategoryThreshold | undefined {
  const key = category.trim().toLowerCase();
  return rules.find(rule => rule.category.trim().toLowerCase() === key);
}

export function scheduleDueParts(input: {
  currentHours: number;
  currentMiles: number | null;
  nextServiceDueDate: string | null;
  nextServiceDueHours: number | null;
  nextServiceDueMiles: number | null;
  today?: string;
}): string[] {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const parts: string[] = [];
  if (input.nextServiceDueDate && input.nextServiceDueDate <= today) parts.push(`date:${input.nextServiceDueDate}`);
  if (input.nextServiceDueHours != null && input.currentHours >= input.nextServiceDueHours) parts.push(`hours:${input.nextServiceDueHours}`);
  if (input.nextServiceDueMiles != null && input.currentMiles != null && input.currentMiles >= input.nextServiceDueMiles) parts.push(`miles:${input.nextServiceDueMiles}`);
  return parts;
}

export function ackCovers(ack: string | null | undefined, parts: string[]): boolean {
  if (!ack || parts.length === 0) return false;
  const tokens = new Set(ack.split("|").filter(Boolean));
  return parts.every(part => tokens.has(part));
}

export function joinSignature(parts: string[]): string {
  return [...new Set(parts)].sort().join("|");
}

export function maintenanceDue(hours: number, rule: CategoryThreshold | undefined): { label: string; bucket: string }[] {
  if (!rule || !Number.isFinite(hours) || hours < 0) return [];
  const due: { label: string; bucket: string }[] = [];
  if (typeof rule.warnHours === "number" && rule.warnHours > 0 && hours >= rule.warnHours) {
    due.push({ label: `Operating-hour warning (${rule.warnHours} hrs)`, bucket: `warn:${rule.warnHours}` });
  }
  if (typeof rule.retireHours === "number" && rule.retireHours > 0 && hours >= rule.retireHours) {
    due.push({ label: `Retirement threshold (${rule.retireHours} hrs)`, bucket: `retire:${rule.retireHours}` });
  }
  for (const interval of rule.intervals ?? []) {
    if (interval.everyHours > 0 && hours >= interval.everyHours) {
      due.push({ label: interval.label, bucket: `${interval.label}:${Math.floor(hours / interval.everyHours)}` });
    }
  }
  return due;
}
