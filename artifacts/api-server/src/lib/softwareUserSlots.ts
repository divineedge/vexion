import type Stripe from "stripe";

export type UserSlotPolicy = { includedUsers: number | null; extraUserPriceCents: number | null; basePriceCents: number; interval: "month" | "year" };
type Plan = { maxUsers: number | null; extraUserPriceCents?: number | null; price: number; billingInterval: string };
export const userSlotPolicy = (plan: Plan): UserSlotPolicy => ({
  includedUsers: plan.maxUsers, extraUserPriceCents: plan.extraUserPriceCents ?? null,
  basePriceCents: Math.round(plan.price * 100), interval: plan.billingInterval as "month" | "year",
});
export function frozenUserSlots(policy: unknown): UserSlotPolicy | null {
  const value = (policy as { userSlots?: UserSlotPolicy } | null)?.userSlots;
  if (!value) return null;
  if ((value.includedUsers !== null && (!Number.isInteger(value.includedUsers) || value.includedUsers < 1)) ||
      (value.extraUserPriceCents !== null && (!Number.isInteger(value.extraUserPriceCents) || value.extraUserPriceCents < 0)) ||
      !Number.isInteger(value.basePriceCents) || value.basePriceCents < 0 || !["month", "year"].includes(value.interval) ||
      (value.extraUserPriceCents !== null && value.includedUsers === null)) throw new Error("Software user-slot pricing needs owner review.");
  return value;
}
export function subscriptionQuantity(policy: UserSlotPolicy, activeUsers: number) {
  if (policy.extraUserPriceCents !== null && policy.includedUsers !== null) return Math.max(policy.includedUsers, activeUsers);
  if (policy.includedUsers !== null && activeUsers > policy.includedUsers) throw new Error(`This plan includes ${policy.includedUsers} users and does not offer extra slots. Deactivate unused accounts or choose another plan.`);
  return 1;
}
export function slotPriceParams(policy: UserSlotPolicy): Pick<Stripe.PriceCreateParams, "unit_amount" | "billing_scheme" | "tiers" | "tiers_mode"> {
  if (policy.extraUserPriceCents === null || policy.includedUsers === null) return { unit_amount: policy.basePriceCents };
  return { billing_scheme: "tiered", tiers_mode: "graduated", tiers: [
    { up_to: policy.includedUsers, flat_amount: policy.basePriceCents, unit_amount: 0 },
    { up_to: "inf", flat_amount: 0, unit_amount: policy.extraUserPriceCents },
  ] };
}
export function verifySlotPrice(price: Stripe.Price, policy: UserSlotPolicy) {
  if (!price.active || price.currency !== "usd" || price.recurring?.interval !== policy.interval) throw new Error("Plan pricing needs provider verification");
  if (policy.extraUserPriceCents === null) {
    if (price.unit_amount !== policy.basePriceCents || price.billing_scheme === "tiered") throw new Error("Plan pricing needs provider verification");
  } else {
    const [included, extra] = price.tiers ?? [];
    if (price.recurring?.usage_type !== "licensed" || price.billing_scheme !== "tiered" || price.tiers_mode !== "graduated" || price.tiers?.length !== 2 ||
        included?.up_to !== policy.includedUsers || included.flat_amount !== policy.basePriceCents || included.unit_amount !== 0 ||
        extra?.up_to !== null || extra.flat_amount !== 0 || extra.unit_amount !== policy.extraUserPriceCents)
      throw new Error("Extra-user pricing needs provider verification");
  }
}
