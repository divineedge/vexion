import { z } from "zod/v4";
import { db, platformBillingSettingsTable, softwareBillingAccountsTable, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const feeFields = {
  cardFeeBps: z.number().int().min(0).max(10000),
  cardFeeFixedCents: z.number().int().min(0).max(100000),
  achFeeBps: z.number().int().min(0).max(10000),
  achFeeFixedCents: z.number().int().min(0).max(100000),
};
export const platformSettingsInput = z.object({ enabled: z.boolean(), ...feeFields, confirmActivation: z.boolean().optional() }).strict();
export const softwarePlanInput = z.object({
  name: z.string().trim().min(1).max(120), tier: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,49}$/),
  price: z.number().finite().min(0).max(100000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001),
  billingInterval: z.enum(["month", "year"]), active: z.boolean(),
  features: z.array(z.string().trim().min(1).max(200)).max(50),
  maxUsers: z.number().int().min(1).max(100000).nullable(),
  maxProperties: z.number().int().min(1).max(10000000).nullable(),
  cardFeeBps: feeFields.cardFeeBps.nullable(), cardFeeFixedCents: feeFields.cardFeeFixedCents.nullable(),
  achFeeBps: feeFields.achFeeBps.nullable(), achFeeFixedCents: feeFields.achFeeFixedCents.nullable(),
}).strict();
export function effectivePlatformFees(plan:typeof plansTable.$inferSelect|undefined,settings:Awaited<ReturnType<typeof platformSettings>>) {
  const published=z.object({
    cardFeeBps:feeFields.cardFeeBps.nullable(),cardFeeFixedCents:feeFields.cardFeeFixedCents.nullable(),
    achFeeBps:feeFields.achFeeBps.nullable(),achFeeFixedCents:feeFields.achFeeFixedCents.nullable(),
  }).partial().parse(plan?.publishedFeePolicy??{});
  return {...settings,cardFeeBps:published.cardFeeBps??settings.cardFeeBps,cardFeeFixedCents:published.cardFeeFixedCents??settings.cardFeeFixedCents,
    achFeeBps:published.achFeeBps??settings.achFeeBps,achFeeFixedCents:published.achFeeFixedCents??settings.achFeeFixedCents};
}
export function feeCents(amount: number, basisPoints: number, fixed: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid payment amount");
  return Math.min(amount, Math.round(amount * basisPoints / 10000) + fixed);
}
export async function platformSettings() {
  const [row] = await db.select().from(platformBillingSettingsTable).where(eq(platformBillingSettingsTable.id, 1));
  return row ?? { id: 1, enabled: false, cardFeeBps: 0, cardFeeFixedCents: 0, achFeeBps: 0, achFeeFixedCents: 0 };
}
/** Snapshot future-payment rules. Never change a customer's invoice total. */
export async function platformPaymentMetadata(tenantId: number, amount: number): Promise<Record<string,string>> {
  const settings = await platformSettings();
  const [account] = await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId, tenantId));
  if (!account?.connectReady || !account.connectAccountId || !account.termsAcceptedAt){
    if(!settings.enabled)return {};
    throw new Error("This business must complete its payment payout setup before accepting online payments.");
  }
  const [plan] = account.planId && account.stripeSubscriptionId && ["active","trialing"].includes(account.status)
    ? await db.select().from(plansTable).where(eq(plansTable.id, account.planId)) : [];
  const fees=effectivePlatformFees(plan,settings);
  return {
    platform_payments: "v1", platform_destination: account.connectAccountId,
    platform_tenant: String(tenantId), platform_amount: String(amount),
    platform_card_fee: String(settings.enabled?feeCents(amount,fees.cardFeeBps,fees.cardFeeFixedCents):0),
    platform_ach_fee: String(settings.enabled?feeCents(amount,fees.achFeeBps,fees.achFeeFixedCents):0),
  };
}
