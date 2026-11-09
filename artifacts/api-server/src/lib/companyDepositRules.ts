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
  /** Active scheduling deposit: 'percent' of the estimate total, or a fixed dollar amount. */
  schedulingDepositType: "fixed" | "percent";
  schedulingDepositValue: number | null;
  /** Remembered inputs so switching between % and $ does not drop the other amount. */
  schedulingDepositPercent: number | null;
  schedulingDepositFixed: number | null;
  allowEstimateOverrides: boolean;
  rules: DepositRule[];
  scheduling_deposit_type?: "fixed" | "percent";
  scheduling_deposit_value?: number | null;
};

export const defaultEstimateDepositSettings: EstimateDepositSettings = {
  enabled: false,
  defaultType: "percent",
  defaultAmount: null,
  requireBeforeScheduling: false,
  schedulingDepositType: "percent",
  schedulingDepositValue: null,
  schedulingDepositPercent: null,
  schedulingDepositFixed: null,
  scheduling_deposit_type: "percent",
  scheduling_deposit_value: null,
  allowEstimateOverrides: false,
  rules: [],
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

function depositMode(value: unknown): "fixed" | "percent" | null {
  return value === "fixed" || value === "percent" ? value : null;
}

function schedulingFields(raw: Record<string, unknown>, fallbackType: "fixed" | "percent", fallbackAmount: number | null) {
  const explicitType = depositMode(raw.scheduling_deposit_type) ?? depositMode(raw.schedulingDepositType);
  const explicitValue = raw.scheduling_deposit_value ?? raw.schedulingDepositValue;
  const schedulingDepositType = explicitType ?? fallbackType;
  const schedulingDepositPercent = depositAmount(
    raw.scheduling_deposit_percent ?? raw.schedulingDepositPercent ?? (schedulingDepositType === "percent" ? explicitValue : fallbackType === "percent" ? fallbackAmount : null),
    "percent",
  );
  const schedulingDepositFixed = depositAmount(
    raw.scheduling_deposit_fixed ?? raw.schedulingDepositFixed ?? (schedulingDepositType === "fixed" ? explicitValue : fallbackType === "fixed" ? fallbackAmount : null),
    "fixed",
  );
  const schedulingDepositValue = schedulingDepositType === "fixed"
    ? schedulingDepositFixed ?? depositAmount(explicitValue, "fixed") ?? (fallbackType === "fixed" ? fallbackAmount : null)
    : schedulingDepositPercent ?? depositAmount(explicitValue, "percent") ?? (fallbackType === "percent" ? fallbackAmount : null);
  return { schedulingDepositType, schedulingDepositValue, schedulingDepositPercent, schedulingDepositFixed };
}

export function normalizeEstimateDepositSettings(value: unknown): EstimateDepositSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaultType = raw.defaultType === "fixed" ? "fixed" : "percent";
  const defaultAmount = depositAmount(raw.defaultAmount, defaultType);
  const scheduling = schedulingFields(raw, defaultType, defaultAmount);
  return {
    ...defaultEstimateDepositSettings,
    enabled: raw.enabled === true,
    defaultType,
    defaultAmount,
    requireBeforeScheduling: raw.requireBeforeScheduling === true,
    ...scheduling,
    scheduling_deposit_type: scheduling.schedulingDepositType,
    scheduling_deposit_value: scheduling.schedulingDepositValue,
    allowEstimateOverrides: raw.allowEstimateOverrides === true,
    rules: rulesFrom(raw.rules),
  };
}

/** Always returns a complete document, even when the tenant JSON has no deposit keys yet. */
export function coerceEstimateDepositSettings(value: unknown): EstimateDepositSettings {
  const settings = normalizeEstimateDepositSettings(value);
  return {
    ...defaultEstimateDepositSettings,
    ...settings,
    defaultType: settings.defaultType === "fixed" ? "fixed" : "percent",
    defaultAmount: typeof settings.defaultAmount === "number" && Number.isFinite(settings.defaultAmount) ? settings.defaultAmount : null,
    schedulingDepositType: settings.schedulingDepositType === "fixed" ? "fixed" : "percent",
    schedulingDepositValue: typeof settings.schedulingDepositValue === "number" && Number.isFinite(settings.schedulingDepositValue) ? settings.schedulingDepositValue : null,
    schedulingDepositPercent: typeof settings.schedulingDepositPercent === "number" && Number.isFinite(settings.schedulingDepositPercent) ? settings.schedulingDepositPercent : null,
    schedulingDepositFixed: typeof settings.schedulingDepositFixed === "number" && Number.isFinite(settings.schedulingDepositFixed) ? settings.schedulingDepositFixed : null,
    scheduling_deposit_type: settings.schedulingDepositType === "fixed" ? "fixed" : "percent",
    scheduling_deposit_value: typeof settings.schedulingDepositValue === "number" && Number.isFinite(settings.schedulingDepositValue) ? settings.schedulingDepositValue : null,
    rules: Array.isArray(settings.rules) ? settings.rules : [],
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
  const requireBeforeScheduling = schedule.enabled || root.requirePrepay === true || enabled;
  const schedulingDepositType = schedule.enabled ? schedule.mode : defaultType;
  const schedulingDepositValue = schedule.enabled ? depositAmount(schedule.value, schedule.mode) : defaultAmount;
  return {
    enabled,
    defaultType,
    defaultAmount,
    // Older companies already blocked scheduling whenever a deposit was required.
    requireBeforeScheduling,
    schedulingDepositType,
    schedulingDepositValue,
    schedulingDepositPercent: schedulingDepositType === "percent" ? schedulingDepositValue : defaultType === "percent" ? defaultAmount : null,
    schedulingDepositFixed: schedulingDepositType === "fixed" ? schedulingDepositValue : defaultType === "fixed" ? defaultAmount : null,
    scheduling_deposit_type: schedulingDepositType,
    scheduling_deposit_value: schedulingDepositValue,
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
  const hasToggle = "enabled" in raw || "defaultType" in raw || "requireBeforeScheduling" in raw || "allowEstimateOverrides" in raw || "defaultAmount" in raw
    || "scheduling_deposit_type" in raw || "schedulingDepositType" in raw || "scheduling_deposit_value" in raw || "schedulingDepositValue" in raw;
  if (hasToggle) {
    if (("enabled" in raw || "requireBeforeScheduling" in raw || "allowEstimateOverrides" in raw || "defaultType" in raw || "defaultAmount" in raw)
      && (typeof raw.enabled !== "boolean" || typeof raw.requireBeforeScheduling !== "boolean" || typeof raw.allowEstimateOverrides !== "boolean")) return "Choose whether deposits are required";
    if ("defaultType" in raw && raw.defaultType !== "fixed" && raw.defaultType !== "percent") return "Choose a percentage or a fixed dollar amount";
    if (raw.enabled) {
      if (typeof raw.defaultAmount !== "number" || !Number.isFinite(raw.defaultAmount) || raw.defaultAmount <= 0) return "Enter a default deposit greater than zero";
      if (raw.defaultType === "percent" && raw.defaultAmount > 100) return "Percentage cannot exceed 100";
      if (raw.defaultType === "fixed" && raw.defaultAmount > 1_000_000) return "Amount is too large";
      if (Math.abs(raw.defaultAmount * 100 - Math.round(raw.defaultAmount * 100)) > 0.001) return "Use at most two decimal places";
    }
    const scheduleType = raw.scheduling_deposit_type ?? raw.schedulingDepositType;
    const scheduleValue = raw.scheduling_deposit_value ?? raw.schedulingDepositValue;
    if (scheduleType !== undefined && scheduleType !== "fixed" && scheduleType !== "percent") return "Choose a percentage or a fixed dollar amount for scheduling";
    if (raw.enabled === true && raw.requireBeforeScheduling === true) {
      const type = scheduleType === "fixed" ? "fixed" : scheduleType === "percent" ? "percent" : null;
      if (!type) return "Choose a percentage or a fixed dollar amount for scheduling";
      if (typeof scheduleValue !== "number" || !Number.isFinite(scheduleValue) || scheduleValue <= 0) return "Enter the deposit required before scheduling";
      if (type === "percent" && scheduleValue > 100) return "Percentage cannot exceed 100";
      if (type === "fixed" && scheduleValue > 1_000_000) return "Amount is too large";
      if (Math.abs(scheduleValue * 100 - Math.round(scheduleValue * 100)) > 0.001) return "Use at most two decimal places";
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
  const schedulingType = depositMode(raw.scheduling_deposit_type) ?? depositMode(raw.schedulingDepositType) ?? current.schedulingDepositType;
  return normalizeEstimateDepositSettings({
    enabled,
    defaultType,
    defaultAmount: "defaultAmount" in raw ? raw.defaultAmount : current.defaultAmount,
    requireBeforeScheduling: typeof raw.requireBeforeScheduling === "boolean" ? raw.requireBeforeScheduling : current.requireBeforeScheduling,
    scheduling_deposit_type: schedulingType,
    scheduling_deposit_value: "scheduling_deposit_value" in raw ? raw.scheduling_deposit_value : "schedulingDepositValue" in raw ? raw.schedulingDepositValue : current.schedulingDepositValue,
    scheduling_deposit_percent: "scheduling_deposit_percent" in raw ? raw.scheduling_deposit_percent : "schedulingDepositPercent" in raw ? raw.schedulingDepositPercent : current.schedulingDepositPercent,
    scheduling_deposit_fixed: "scheduling_deposit_fixed" in raw ? raw.scheduling_deposit_fixed : "schedulingDepositFixed" in raw ? raw.schedulingDepositFixed : current.schedulingDepositFixed,
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
      mode: settings.schedulingDepositType,
      value: settings.schedulingDepositValue,
    } satisfies ScheduleDepositSetting,
  };
}

export function readScheduleDeposit(policy: unknown): ScheduleDepositSetting {
  if (hasStoredEstimateDepositSettings(policy)) {
    const settings = readEstimateDepositSettings(policy);
    return {
      enabled: settings.enabled && settings.requireBeforeScheduling,
      mode: settings.schedulingDepositType ?? "percent",
      value: settings.schedulingDepositValue ?? null,
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

/** Percentage of the estimate total, or a fixed dollar amount capped at that total. */
export function schedulingDepositTarget(type: "fixed" | "percent", value: number | null, total: number): { amount: number; needsPrice: boolean } {
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) return { amount: 0, needsPrice: false };
  if (type === "percent") {
    if (!(total > 0)) return { amount: 0, needsPrice: true };
    return { amount: Math.round(total * value) / 100, needsPrice: false };
  }
  const fixed = Math.round(value * 100) / 100;
  if (total > 0 && fixed > total) return { amount: Math.round(total * 100) / 100, needsPrice: false };
  return { amount: fixed, needsPrice: false };
}

export function scheduleDepositAmount(setting: ScheduleDepositSetting, total: number): { amount: number; needsPrice: boolean } {
  if (!setting.enabled) return { amount: 0, needsPrice: false };
  return schedulingDepositTarget(setting.mode, setting.value, total);
}

export function depositRequiredBeforeSchedulingMessage(amount: number): string {
  const money = (Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `Deposit of ${money} required prior to scheduling`;
}

export function depositInvoiceSatisfied(invoice: { status?: string | null; total?: number | null; creditApplied?: number | null; depositApplied?: number | null }): boolean {
  if (!invoice || invoice.status === "void" || invoice.status === "cancelled") return false;
  if (invoice.status === "paid") return true;
  const balance = Math.max(0, Math.round(((invoice.total ?? 0) - (invoice.creditApplied ?? 0) - (invoice.depositApplied ?? 0)) * 100));
  return balance <= 0 && (invoice.total ?? 0) > 0;
}

export function unpaidScheduleDepositMessage(setting: ScheduleDepositSetting, total: number, received: number): string | null {
  if (!setting.enabled) return null;
  const { amount, needsPrice } = schedulingDepositTarget(setting.mode, setting.value, total);
  if (needsPrice && Math.round(received * 100) <= 0) {
    return "Set a positive job or estimate total before scheduling. A percentage deposit is required.";
  }
  if (amount <= 0 || Math.round(received * 100) >= Math.round(amount * 100)) return null;
  return depositRequiredBeforeSchedulingMessage(amount);
}

export function firstMatchingDepositRule(rules: DepositRule[], total: number | undefined, serviceIds: number[]) {
  return rules.find(rule => rule.enabled &&
    (rule.minTotal === null || total !== undefined && total >= rule.minTotal) &&
    (rule.maxTotal === null || total !== undefined && total < rule.maxTotal) &&
    (!rule.serviceIds.length || (rule.serviceMatch === "all"
      ? rule.serviceIds.every(id => serviceIds.includes(id))
      : rule.serviceIds.some(id => serviceIds.includes(id)))));
}
