export type DepositRule = {
  id: string; name: string; enabled: boolean;
  minTotal: number | null; maxTotal: number | null;
  serviceIds: number[]; serviceMatch: "any" | "all";
  depositType: "none" | "fixed" | "percent" | "full"; depositValue: number | null;
};

export function validateDepositRules(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > 50) return "Provide at most 50 deposit rules";
  const ids = new Set<string>();
  for (const rule of value) {
    if (!rule || typeof rule !== "object" || typeof rule.id !== "string" || !rule.id || rule.id.length > 100 ||
      ids.has(rule.id) || typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 100 ||
      typeof rule.enabled !== "boolean") return "Each rule needs a unique ID, a name, and an enabled flag";
    ids.add(rule.id);
    for (const bound of [rule.minTotal, rule.maxTotal]) {
      if (bound !== null && (typeof bound !== "number" || !Number.isFinite(bound) || bound < 0)) return "Amount bounds must be positive numbers or blank";
    }
    if (rule.maxTotal !== null && rule.maxTotal <= (rule.minTotal ?? 0)) return "Maximum total must exceed minimum total";
    if (!Array.isArray(rule.serviceIds) || rule.serviceIds.length > 100 ||
      rule.serviceIds.some((id: unknown) => typeof id !== "number" || !Number.isInteger(id) || id <= 0) ||
      new Set(rule.serviceIds).size !== rule.serviceIds.length || !["any", "all"].includes(rule.serviceMatch)) return "Choose valid services and a matching mode";
    if (!["none", "fixed", "percent", "full"].includes(rule.depositType)) return "Choose a valid deposit type";
    if (["fixed", "percent"].includes(rule.depositType)) {
      if (typeof rule.depositValue !== "number" || !Number.isFinite(rule.depositValue) || rule.depositValue <= 0 ||
        rule.depositValue > (rule.depositType === "percent" ? 100 : 1000000)) return "Enter a positive deposit amount (percentage cannot exceed 100)";
    } else if (rule.depositValue !== null) return "No-deposit and full-payment rules do not need an amount";
  }
  return null;
}

/** All company deposit settings live in tenants.payment_policy and are edited under Estimate Settings. */
export const estimateSettingsDepositKeys = {
  companyDefault: ["depositType", "depositValue", "requirePrepay", "requireCard"],
  rules: "depositRules",
  scheduleDeposit: "scheduleDeposit",
} as const;

/** Stored at tenants.payment_policy.scheduleDeposit. Mirrored from estimate_deposit_settings. */
export type ScheduleDepositSetting = {
  enabled: boolean;
  mode: "fixed" | "percent";
  value: number | null;
};

/** Unified Estimate Settings document at tenants.payment_policy.estimate_deposit_settings. */
export const ESTIMATE_DEPOSIT_SETTINGS_KEY = "estimate_deposit_settings";

export type EstimateDepositSettings = {
  enabled: boolean;
  defaultType: "fixed" | "percent";
  defaultAmount: number | null;
  requireBeforeScheduling: boolean;
  allowEstimateOverrides: boolean;
  rules: DepositRule[];
};

export function hasStoredEstimateDepositSettings(policy: unknown): boolean {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  const stored = (policy as Record<string, unknown>)[ESTIMATE_DEPOSIT_SETTINGS_KEY];
  return !!stored && typeof stored === "object" && !Array.isArray(stored);
}

export const scheduleDepositOff: ScheduleDepositSetting = { enabled: false, mode: "fixed", value: null };

function depositAmount(value: unknown, mode: "fixed" | "percent"): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (mode === "percent" && value > 100) return null;
  if (mode === "fixed" && value > 1_000_000) return null;
  return Math.round(value * 100) / 100;
}

function rulesFrom(value: unknown): DepositRule[] {
  return validateDepositRules(value) === null && Array.isArray(value) ? value as DepositRule[] : [];
}

export function normalizeEstimateDepositSettings(value: unknown): EstimateDepositSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaultType = raw.defaultType === "fixed" ? "fixed" : "percent";
  return {
    enabled: raw.enabled === true,
    defaultType,
    defaultAmount: depositAmount(raw.defaultAmount, defaultType),
    requireBeforeScheduling: raw.requireBeforeScheduling === true,
    allowEstimateOverrides: raw.allowEstimateOverrides === true,
    rules: rulesFrom(raw.rules),
  };
}

function legacyEstimateDepositSettings(policy: unknown): EstimateDepositSettings {
  const root = policy && typeof policy === "object" && !Array.isArray(policy) ? policy as Record<string, unknown> : {};
  const schedule = normalizeScheduleDeposit(root.scheduleDeposit);
  const rules = rulesFrom(root.depositRules);
  let defaultType: "fixed" | "percent" = schedule.mode === "fixed" ? "fixed" : "percent";
  let defaultAmount: number | null = null;
  let enabled = false;
  if (root.depositType === "fixed" || root.depositType === "percent") {
    defaultType = root.depositType;
    defaultAmount = depositAmount(root.depositValue, defaultType);
    enabled = defaultAmount != null;
  } else if (root.depositType === "full" || root.requirePrepay === true) {
    defaultType = "percent";
    defaultAmount = 100;
    enabled = true;
  }
  if (!enabled && schedule.enabled) {
    defaultType = schedule.mode;
    defaultAmount = depositAmount(schedule.value, schedule.mode);
    enabled = defaultAmount != null;
  }
  if (!enabled && rules.some(rule => rule.enabled && rule.depositType !== "none")) enabled = true;
  return {
    enabled,
    defaultType,
    defaultAmount,
    // Older companies already blocked scheduling whenever a deposit was required.
    requireBeforeScheduling: schedule.enabled || root.requirePrepay === true || enabled,
    allowEstimateOverrides: rules.length > 0,
    rules,
  };
}

/** Prefer the unified document. Companies saved before it existed keep their previous deposit, schedule, and rule fields. */
export function readEstimateDepositSettings(policy: unknown): EstimateDepositSettings {
  if (hasStoredEstimateDepositSettings(policy)) {
    return normalizeEstimateDepositSettings((policy as Record<string, unknown>)[ESTIMATE_DEPOSIT_SETTINGS_KEY]);
  }
  return legacyEstimateDepositSettings(policy);
}

export function validateEstimateDepositSettings(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Choose the deposit and prepayment rules";
  const raw = value as Record<string, unknown>;
  const hasToggle = "enabled" in raw || "defaultType" in raw || "requireBeforeScheduling" in raw || "allowEstimateOverrides" in raw || "defaultAmount" in raw;
  if (hasToggle) {
    if (typeof raw.enabled !== "boolean" || typeof raw.requireBeforeScheduling !== "boolean" || typeof raw.allowEstimateOverrides !== "boolean") return "Choose whether deposits are required";
    if (raw.defaultType !== "fixed" && raw.defaultType !== "percent") return "Choose a percentage or a fixed dollar amount";
    if (raw.enabled) {
      if (typeof raw.defaultAmount !== "number" || !Number.isFinite(raw.defaultAmount) || raw.defaultAmount <= 0) return "Enter a default deposit greater than zero";
      if (raw.defaultType === "percent" && raw.defaultAmount > 100) return "Percentage cannot exceed 100";
      if (raw.defaultType === "fixed" && raw.defaultAmount > 1_000_000) return "Amount is too large";
      if (Math.abs(raw.defaultAmount * 100 - Math.round(raw.defaultAmount * 100)) > 0.001) return "Use at most two decimal places";
    }
  }
  if ("rules" in raw) {
    const rulesError = validateDepositRules(raw.rules);
    if (rulesError) return rulesError;
  }
  if (!hasToggle && !("rules" in raw)) return "Choose the deposit and prepayment rules";
  return null;
}

export function mergeEstimateDepositSettings(policy: unknown, patch: unknown): EstimateDepositSettings {
  const current = readEstimateDepositSettings(policy);
  const raw = patch && typeof patch === "object" && !Array.isArray(patch) ? patch as Record<string, unknown> : {};
  const defaultType = raw.defaultType === "fixed" || raw.defaultType === "percent" ? raw.defaultType : current.defaultType;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : current.enabled;
  return normalizeEstimateDepositSettings({
    enabled,
    defaultType,
    defaultAmount: "defaultAmount" in raw ? raw.defaultAmount : current.defaultAmount,
    requireBeforeScheduling: typeof raw.requireBeforeScheduling === "boolean" ? raw.requireBeforeScheduling : current.requireBeforeScheduling,
    allowEstimateOverrides: typeof raw.allowEstimateOverrides === "boolean" ? raw.allowEstimateOverrides : current.allowEstimateOverrides,
    rules: "rules" in raw ? raw.rules : current.rules,
  });
}

/** Writes the unified key and the legacy fields scheduling and estimates already understand. */
export function estimateDepositSettingsDocument(settings: EstimateDepositSettings): Record<string, unknown> {
  return {
    [ESTIMATE_DEPOSIT_SETTINGS_KEY]: settings,
    depositType: settings.enabled ? settings.defaultType : "none",
    depositValue: settings.enabled ? settings.defaultAmount : null,
    depositRules: settings.rules,
    scheduleDeposit: {
      enabled: settings.enabled && settings.requireBeforeScheduling,
      mode: settings.defaultType,
      value: settings.defaultAmount,
    } satisfies ScheduleDepositSetting,
  };
}

export function readScheduleDeposit(policy: unknown): ScheduleDepositSetting {
  if (hasStoredEstimateDepositSettings(policy)) {
    const settings = readEstimateDepositSettings(policy);
    return {
      enabled: settings.enabled && settings.requireBeforeScheduling,
      mode: settings.defaultType,
      value: settings.defaultAmount,
    };
  }
  const nested = policy && typeof policy === "object" && !Array.isArray(policy)
    ? (policy as Record<string, unknown>)[estimateSettingsDepositKeys.scheduleDeposit]
    : undefined;
  return normalizeScheduleDeposit(nested);
}

export function normalizeScheduleDeposit(value: unknown): ScheduleDepositSetting {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...scheduleDepositOff };
  const raw = value as Partial<ScheduleDepositSetting>;
  const mode = raw.mode === "percent" ? "percent" : "fixed";
  const enabled = raw.enabled === true;
  const amount = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : null;
  return { enabled, mode, value: amount };
}

export function validateScheduleDeposit(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Choose whether a deposit is required to schedule";
  const raw = value as Partial<ScheduleDepositSetting>;
  if (typeof raw.enabled !== "boolean" || (raw.mode !== "fixed" && raw.mode !== "percent")) return "Choose a fixed amount or a percentage";
  if (!raw.enabled) return null;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value <= 0) return "Enter a deposit greater than zero";
  if (raw.mode === "percent" && raw.value > 100) return "Percentage cannot exceed 100";
  if (raw.mode === "fixed" && raw.value > 1_000_000) return "Amount is too large";
  if (Math.abs(raw.value * 100 - Math.round(raw.value * 100)) > 0.001) return "Use at most two decimal places";
  return null;
}

export function scheduleDepositAmount(setting: ScheduleDepositSetting, total: number): { amount: number; needsPrice: boolean } {
  if (!setting.enabled || !(setting.value && setting.value > 0)) return { amount: 0, needsPrice: false };
  if (setting.mode === "percent") {
    if (!(total > 0)) return { amount: 0, needsPrice: true };
    return { amount: Math.round(total * setting.value) / 100, needsPrice: false };
  }
  return { amount: Math.round(setting.value * 100) / 100, needsPrice: false };
}

export function unpaidScheduleDepositMessage(setting: ScheduleDepositSetting, total: number, received: number): string | null {
  if (!setting.enabled) return null;
  const { amount, needsPrice } = scheduleDepositAmount(setting, total);
  if (needsPrice && Math.round(received * 100) <= 0) {
    return "Set a positive job or estimate total before scheduling. A percentage deposit is required.";
  }
  if (amount <= 0 || Math.round(received * 100) >= Math.round(amount * 100)) return null;
  const money = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (setting.mode === "percent") return `A deposit of ${setting.value}% (${money}) is required before this job can be scheduled.`;
  return `A deposit of ${money} is required before this job can be scheduled.`;
}

export function firstMatchingDepositRule(rules: DepositRule[], total: number | undefined, serviceIds: number[]) {
  return rules.find(rule => rule.enabled &&
    (rule.minTotal === null || total !== undefined && total >= rule.minTotal) &&
    (rule.maxTotal === null || total !== undefined && total < rule.maxTotal) &&
    (!rule.serviceIds.length || (rule.serviceMatch === "all"
      ? rule.serviceIds.every(id => serviceIds.includes(id))
      : rule.serviceIds.some(id => serviceIds.includes(id)))));
}
