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

export function firstMatchingDepositRule(rules: DepositRule[], total: number | undefined, serviceIds: number[]) {
  return rules.find(rule => rule.enabled &&
    (rule.minTotal === null || total !== undefined && total >= rule.minTotal) &&
    (rule.maxTotal === null || total !== undefined && total < rule.maxTotal) &&
    (!rule.serviceIds.length || (rule.serviceMatch === "all"
      ? rule.serviceIds.every(id => serviceIds.includes(id))
      : rule.serviceIds.some(id => serviceIds.includes(id)))));
}
