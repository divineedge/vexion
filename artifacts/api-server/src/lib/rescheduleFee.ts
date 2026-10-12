import type { jobsTable } from "@workspace/db";

/** The fee is a job line item, never a card charge. Empty choice means no fee for older clients. */
export function rescheduleFee(job: typeof jobsTable.$inferSelect, input: { chargeRescheduleFee?: unknown; rescheduleFeeAmount?: unknown }) {
  if (input.chargeRescheduleFee !== undefined && typeof input.chargeRescheduleFee !== "boolean") throw new Error("Choose whether to charge a rescheduling fee");
  if (input.chargeRescheduleFee !== true) return {};
  if (job.invoiceId != null) throw new Error("This job is already invoiced; adjust its invoice separately");
  const amount = Number(input.rescheduleFeeAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter a rescheduling fee greater than zero");
  const fee = Math.round(amount * 100) / 100;
  const items = (job.lineItems as Record<string, unknown>[]) ?? [];
  return {
    lineItems: [...items, { id: crypto.randomUUID(), description: "Rescheduling fee", name: "Rescheduling fee", quantity: 1, unitPrice: fee, total: fee }],
    totalAmount: Math.round(((job.totalAmount ?? 0) + fee) * 100) / 100,
  };
}
