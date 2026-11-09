export type ServiceReminderMode = "enabled" | "disabled" | "selective";

export function normalizeServiceReminderMode(value: unknown): ServiceReminderMode {
  if (value === "disabled" || value === "never") return "disabled";
  if (value === "selective") return "selective";
  return "enabled";
}

export function normalizeExcludedReminderServiceIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is number => Number.isInteger(id) && id > 0);
  if (ids.length !== value.length || new Set(ids).size !== ids.length || ids.length > 500) return null;
  return ids;
}

export function jobServiceIds(job: { serviceId?: number | null; lineItems?: unknown }): number[] {
  const ids: number[] = [];
  if (Number.isInteger(job.serviceId) && (job.serviceId ?? 0) > 0) ids.push(job.serviceId as number);
  if (Array.isArray(job.lineItems)) {
    for (const item of job.lineItems) {
      const serviceId = item && typeof item === "object" ? (item as { serviceId?: unknown }).serviceId : undefined;
      if (Number.isInteger(serviceId) && (serviceId as number) > 0) ids.push(serviceId as number);
    }
  }
  return [...new Set(ids)];
}

/** Automated SMS, email, and push reminders. Selective mode sends only when an attached service is not excluded. */
export function automatedServiceReminderAllowed(
  mode: unknown,
  excludedServiceIds: unknown,
  serviceIds: number[],
): boolean {
  const resolved = normalizeServiceReminderMode(mode);
  if (resolved === "disabled") return false;
  if (resolved === "enabled") return true;
  const excluded = new Set(Array.isArray(excludedServiceIds) ? excludedServiceIds.filter((id): id is number => Number.isInteger(id) && id > 0) : []);
  const attached = [...new Set(serviceIds.filter(id => Number.isInteger(id) && id > 0))];
  return attached.some(id => !excluded.has(id));
}
