import { z } from "zod";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const achPolicySchema = z.object({
  mode: z.enum(["disabled", "optional", "offer_above", "require_above"]),
  threshold: z.number().finite().min(0).max(1_000_000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "Use dollars and cents"),
}).strict();
export type AchPolicy = z.infer<typeof achPolicySchema>;
export const defaultAchPolicy: AchPolicy = { mode: "disabled", threshold: 500 };

export function readAchPolicy(paymentPolicy: unknown): AchPolicy {
  const stored = (paymentPolicy as { ach?: unknown } | null)?.ach;
  if (stored == null) return { ...defaultAchPolicy };
  return achPolicySchema.parse(stored);
}

/** Compare the actual amount being collected, after credits/deposits, in integer cents.
 * The threshold is inclusive: a $500 rule applies to a $500 payment. */
export function allowedInvoiceMethods(policy: AchPolicy, amountCents: number): Array<"card" | "us_bank_account"> {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Invalid payment amount");
  if (policy.mode === "disabled") return ["card"];
  if (policy.mode === "optional") return ["card", "us_bank_account"];
  if (amountCents < Math.round(policy.threshold * 100)) return ["card"];
  return policy.mode === "require_above" ? ["us_bank_account"] : ["card", "us_bank_account"];
}

export async function getAchPolicy(tenantId: number) {
  const [company] = await db.select({ paymentPolicy: tenantsTable.paymentPolicy }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!company) throw new Error("Company not found");
  return readAchPolicy(company.paymentPolicy);
}

export const PAYMENT_AUTHORIZATION_VERSION = "future-payment-methods-v2";
export const PAYMENT_AUTHORIZATION_TERMS = "With this option selected, I authorize the business named on this invoice to save my selected payment method securely with Stripe and charge it for future invoices for services I authorize, when sent, on the due date, or when staff initiates payment under the business's billing policy. For a bank account, I also agree to the ACH debit authorization displayed by Stripe. I can withdraw future-payment authorization by contacting the business or removing the saved method in my profile. Full bank account numbers, bank login credentials, card numbers and security codes are handled by Stripe, not stored in this software. Uncheck this option for a one-time payment without authorizing future charges.";
