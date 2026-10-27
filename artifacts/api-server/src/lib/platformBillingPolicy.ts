import { z } from "zod/v4";
import { db, platformBillingSettingsTable, softwareBillingAccountsTable, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const feeBoundsFields = {
  cardFeeMinCents: z.number().int().min(0).max(1000000000).nullable().optional(),
  cardFeeMaxCents: z.number().int().min(0).max(1000000000).nullable().optional(),
  achFeeMinCents: z.number().int().min(0).max(1000000000).nullable().optional(),
  achFeeMaxCents: z.number().int().min(0).max(1000000000).nullable().optional(),
};
const validateBounds = (value: {cardFeeMinCents?:number|null;cardFeeMaxCents?:number|null;achFeeMinCents?:number|null;achFeeMaxCents?:number|null}, ctx:z.RefinementCtx) => {
  for (const method of ["card","ach"] as const) {
    const min=value[`${method}FeeMinCents`],max=value[`${method}FeeMaxCents`];
    if(min!=null && max!=null && min>max)ctx.addIssue({code:"custom",path:[`${method}FeeMaxCents`],message:`${method==="card"?"Credit-card":"ACH"} fee maximum must be at least its minimum.`});
  }
};
export const feeFields = {
  cardFeeBps: z.number().int().min(0).max(10000),
  cardFeeFixedCents: z.number().int().min(0).max(100000),
  achFeeBps: z.number().int().min(0).max(10000),
  achFeeFixedCents: z.number().int().min(0).max(100000),
  ...feeBoundsFields,
};
export const platformSettingsInput = z.object({ enabled: z.boolean(), ...feeFields, confirmActivation: z.boolean().optional() }).strict().superRefine(validateBounds);
export const softwarePlanInput = z.object({
  name: z.string().trim().min(1).max(120), tier: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,49}$/),
  price: z.number().finite().min(0).max(100000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001),
  billingInterval: z.enum(["month", "year"]), active: z.boolean(),
  features: z.array(z.string().trim().min(1).max(200)).max(50),
  maxUsers: z.number().int().min(1).max(100000).nullable(),
  maxProperties: z.number().int().min(1).max(10000000).nullable(),
  cardFeeBps: feeFields.cardFeeBps.nullable(), cardFeeFixedCents: feeFields.cardFeeFixedCents.nullable(),
  achFeeBps: feeFields.achFeeBps.nullable(), achFeeFixedCents: feeFields.achFeeFixedCents.nullable(),
  ...feeBoundsFields,
}).strict().superRefine(validateBounds);
export function effectivePlatformFees(plan:typeof plansTable.$inferSelect|undefined,settings:Awaited<ReturnType<typeof platformSettings>>,frozenPolicy?:unknown) {
  const published=z.object({
    cardFeeBps:feeFields.cardFeeBps.nullable(),cardFeeFixedCents:feeFields.cardFeeFixedCents.nullable(),
    achFeeBps:feeFields.achFeeBps.nullable(),achFeeFixedCents:feeFields.achFeeFixedCents.nullable(),
    ...feeBoundsFields,
  }).partial().parse(frozenPolicy??plan?.publishedFeePolicy??{});
  const effective={...settings,cardFeeBps:published.cardFeeBps??settings.cardFeeBps,cardFeeFixedCents:published.cardFeeFixedCents??settings.cardFeeFixedCents,
    achFeeBps:published.achFeeBps??settings.achFeeBps,achFeeFixedCents:published.achFeeFixedCents??settings.achFeeFixedCents,
    cardFeeMinCents:published.cardFeeMinCents??settings.cardFeeMinCents??null,cardFeeMaxCents:published.cardFeeMaxCents??settings.cardFeeMaxCents??null,
    achFeeMinCents:published.achFeeMinCents??settings.achFeeMinCents??null,achFeeMaxCents:published.achFeeMaxCents??settings.achFeeMaxCents??null};
  z.object(feeBoundsFields).superRefine(validateBounds).parse(effective);
  return effective;
}
export function feeCents(amount: number, basisPoints: number, fixed: number, minimum?:number|null, maximum?:number|null) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid payment amount");
  if(!Number.isSafeInteger(basisPoints)||basisPoints<0||basisPoints>10000||!Number.isSafeInteger(fixed)||fixed<0)throw new Error("Invalid platform fee");
  if([minimum,maximum].some(v=>v!=null&&(!Number.isSafeInteger(v)||v<0)) || (minimum!=null&&maximum!=null&&minimum>maximum))throw new Error("Invalid platform fee limits");
  return Math.min(amount, maximum??Number.MAX_SAFE_INTEGER, Math.max(minimum??0,Math.round(amount * basisPoints / 10000) + fixed));
}
export async function platformSettings() {
  const [row] = await db.select().from(platformBillingSettingsTable).where(eq(platformBillingSettingsTable.id, 1));
  return row ?? { id: 1, enabled: false, cardFeeBps: 0, cardFeeFixedCents: 0, achFeeBps: 0, achFeeFixedCents: 0,cardFeeMinCents:null,cardFeeMaxCents:null,achFeeMinCents:null,achFeeMaxCents:null };
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
  const fees=effectivePlatformFees(plan,settings,plan?(account.planPolicy as {feePolicy?:unknown}|null)?.feePolicy:undefined);
  return {
    platform_payments: "v1", platform_destination: account.connectAccountId,
    platform_tenant: String(tenantId), platform_amount: String(amount),
    platform_card_fee: String(settings.enabled?feeCents(amount,fees.cardFeeBps,fees.cardFeeFixedCents,fees.cardFeeMinCents,fees.cardFeeMaxCents):0),
    platform_ach_fee: String(settings.enabled?feeCents(amount,fees.achFeeBps,fees.achFeeFixedCents,fees.achFeeMinCents,fees.achFeeMaxCents):0),
  };
}
