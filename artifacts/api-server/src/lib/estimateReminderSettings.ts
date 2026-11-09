export type EstimateReminderRule = {
  offsetDays: number;
  label: string;
  channels: Array<"email" | "sms">;
  notifyAdmin: boolean;
  createTask: boolean;
};

export type EstimateReminderConfig = {
  enabled: boolean;
  rules: EstimateReminderRule[];
};

export const defaultEstimateReminderSettings: EstimateReminderConfig = { enabled: false, rules: [] };

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ruleFrom(value: unknown): EstimateReminderRule | null {
  const raw = asObject(value);
  const offsetDays = raw.offsetDays;
  if (typeof offsetDays !== "number" || !Number.isInteger(offsetDays) || offsetDays < 1 || offsetDays > 365) return null;
  const channels = Array.isArray(raw.channels)
    ? raw.channels.filter((channel): channel is "email" | "sms" => channel === "email" || channel === "sms")
    : [];
  const notifyAdmin = raw.notifyAdmin === true;
  const createTask = raw.createTask === true;
  if (channels.length === 0 && !notifyAdmin && !createTask) return null;
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 100) : `${offsetDays} days after sending`;
  return { offsetDays, label, channels, notifyAdmin, createTask };
}

/** Missing, null, or partial reminder JSON becomes a complete document. Extra stored keys are kept by the caller when saving. */
export function coerceEstimateReminderSettings(value: unknown): EstimateReminderConfig {
  const raw = asObject(value);
  const seen = new Set<number>();
  const rules: EstimateReminderRule[] = [];
  if (Array.isArray(raw.rules)) {
    for (const item of raw.rules) {
      const rule = ruleFrom(item);
      if (!rule || seen.has(rule.offsetDays)) continue;
      seen.add(rule.offsetDays);
      rules.push(rule);
      if (rules.length === 10) break;
    }
  }
  return { enabled: raw.enabled === true && rules.length > 0, rules };
}
