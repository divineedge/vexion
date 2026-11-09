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
