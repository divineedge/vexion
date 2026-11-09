export interface CustomerPlanShape {
  maxCustomers?: number | null;
  tier?: string | null;
}

/** Null means the plan does not cap customers. A tier named unlimited is never capped. */
export function resolveCustomerLimit(plan: CustomerPlanShape | null | undefined, policy: unknown): number | null {
  const tier = (plan?.tier ?? "").trim().toLowerCase();
  if (tier === "unlimited") return null;
  if (policy && typeof policy === "object" && "maxCustomers" in policy) {
    const value = (policy as { maxCustomers?: unknown }).maxCustomers;
    if (value == null) return null;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  const planLimit = plan?.maxCustomers;
  if (planLimit == null || !Number.isInteger(planLimit) || planLimit <= 0) return null;
  return planLimit;
}

export function customerPlanLimitMessage(limit: number): string {
  return `This software plan allows ${limit} customers. Upgrade the plan to add more. Existing customers stay available.`;
}

export function customerLimitReached(activeCount: number, additional: number, limit: number | null): boolean {
  if (limit == null) return false;
  return activeCount + additional > limit;
}
