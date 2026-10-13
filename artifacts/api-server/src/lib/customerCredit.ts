import { db, invoicesTable, customersTable, customerCreditsTable, jobsTable, estimatesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const cents = (amount: number) => Math.round(amount * 100);
export function invoiceBalance(invoice: { total: number; creditApplied?: number | null; depositApplied?: number | null; status?: string }) {
  if (invoice.status === "paid") return 0;
  return Math.max(0, cents(invoice.total) - cents(invoice.creditApplied ?? 0) - cents(invoice.depositApplied ?? 0)) / 100;
}
export async function creditBalance(tx: Tx | typeof db, tenantId: number, customerId: number) {
  const [row] = await tx.select({ balance: sql<number>`coalesce(sum(round(${customerCreditsTable.amount}::numeric * 100)),0)` })
    .from(customerCreditsTable).where(and(eq(customerCreditsTable.tenantId, tenantId), eq(customerCreditsTable.customerId, customerId)));
  return Number(row.balance) / 100;
}

/** Voiding preserves the document and restores only its prepaid portion, never refunds a card. */
export async function voidCreditedInvoice(tenantId: number, invoiceId: number, userId: number) {
  return db.transaction(async tx => {
    const [invoice] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId))).for("update");
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid" && !["prepaid_credit", "estimate_deposit"].includes(invoice.paymentMethod ?? "")) throw new Error("A cash/card payment must be handled separately before voiding this invoice");
    await tx.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, invoice.customerId)).for("update");
    if (invoice.creditApplied > 0) await tx.insert(customerCreditsTable).values({
      tenantId, customerId: invoice.customerId, amount: invoice.creditApplied,
      kind: "reversal", reference: `Prepaid credit restored from void invoice ${invoice.invoiceNumber}`,
      requestId: `void-invoice:${invoice.id}`, invoiceId, createdBy: userId,
    }).onConflictDoNothing();
    const [updated] = await tx.update(invoicesTable).set({ status: "cancelled", creditApplied: 0, depositApplied: 0, paidAt: null }).where(eq(invoicesTable.id, invoiceId)).returning();
    return updated;
  });
}

/** Same builder interface as insert().values().returning(); all money and document writes share a transaction.
 * Reserves credits even on drafts, so two invoices cannot promise the same prepayment.
 * Historical paid/imported invoices must use the raw insert rather than consuming today's credit.
 */
export function creditedInvoiceInsert(handle: Tx | typeof db, claimJob = false, sourceJobIds: number[] = []) {
  return { values(input: typeof invoicesTable.$inferInsert) {
    const promise = handle.transaction(async tx => {
      if (claimJob && input.jobId) {
        const [job] = await tx.select().from(jobsTable).where(and(eq(jobsTable.id, input.jobId), eq(jobsTable.tenantId, input.tenantId))).for("update");
        if (!job) throw new Error("Job not found");
         if(job.customerId!==input.customerId)throw new Error("Invoice customer does not match the linked job");
        if (job.invoiceId) {
          const [prior] = await tx.select({ status: invoicesTable.status }).from(invoicesTable).where(and(eq(invoicesTable.id, job.invoiceId), eq(invoicesTable.tenantId, input.tenantId)));
          if (!prior || !["void", "cancelled"].includes(prior.status)) throw new Error("Job already invoiced; refresh to view its invoice");
        }
      }
      const [customer] = await tx.select({ id: customersTable.id }).from(customersTable)
        .where(and(eq(customersTable.id, input.customerId), eq(customersTable.tenantId, input.tenantId))).for("update");
      if (!customer) throw new Error("Invoice customer does not belong to this business");
      let deposit = 0;
      let depositEstimateId: number | null = null;
      const depositAllocations: { estimateId: number; amount: number }[] = [];
      const seenEstimates = new Set<number>();
      for (const sourceJobId of [...new Set([...sourceJobIds, ...(input.jobId ? [input.jobId] : [])])]) {
        const [job] = await tx.select({ estimateId: jobsTable.estimateId }).from(jobsTable).where(and(eq(jobsTable.id, sourceJobId), eq(jobsTable.tenantId, input.tenantId), eq(jobsTable.customerId, input.customerId)));
        if (job?.estimateId) {
          if (seenEstimates.has(job.estimateId)) continue;
          seenEstimates.add(job.estimateId);
          const [estimate] = await tx.select().from(estimatesTable).where(and(eq(estimatesTable.id, job.estimateId), eq(estimatesTable.tenantId, input.tenantId), eq(estimatesTable.customerId, input.customerId))).for("update");
          const priorInvoices = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.tenantId, input.tenantId),
            eq(invoicesTable.customerId, input.customerId), sql`${invoicesTable.status} NOT IN ('void','cancelled')`));
          const alreadyApplied = priorInvoices.reduce((sum, prior) => {
            const allocations = ((prior.lineItems ?? []) as { depositAllocations?: { estimateId: number; amount: number }[] }[]).flatMap(line => line.depositAllocations ?? []);
            return sum + (allocations.length ? allocations.filter(allocation => allocation.estimateId === job.estimateId).reduce((value, allocation) => value + cents(allocation.amount), 0)
              : prior.depositEstimateId === job.estimateId ? cents(prior.depositApplied) : 0);
          }, 0);
          const legacyDeduction = (input.lineItems as Array<{ description?: string; total?: number }> | null)?.some(item => /deposit/i.test(item.description ?? "") && (item.total ?? 0) < 0);
          if (estimate?.depositPaidAt && !legacyDeduction && !["cancelled","void"].includes(input.status ?? "draft")) {
            const allocation = Math.min(Math.max(0, cents(estimate.depositChargedAmount ?? 0) - alreadyApplied), Math.max(0, cents(input.total ?? 0) - deposit));
            deposit += allocation;
            if (allocation > 0) {
              depositEstimateId ??= estimate.id;
              depositAllocations.push({ estimateId: estimate.id, amount: allocation / 100 });
            }
          }
        }
      }
      const available = Math.max(0, cents(await creditBalance(tx, input.tenantId, input.customerId)));
      const applied = ["paid", "void", "cancelled"].includes(input.status ?? "draft") ? 0 :
        Math.min(available, Math.max(0, cents(input.total ?? 0) - deposit));
      const fullyCovered = applied + deposit > 0 && applied + deposit === cents(input.total ?? 0);
      const paid = fullyCovered && input.status !== "draft" && input.status != null;
      const [invoice] = await tx.insert(invoicesTable).values({
        ...input, creditApplied: applied / 100, depositApplied: deposit / 100, depositEstimateId,
         ...(depositAllocations.length && Array.isArray(input.lineItems) && input.lineItems.length
           ? { lineItems: input.lineItems.map((line, index) => index === 0 ? { ...(line as object), depositAllocations } : line) } : {}),
        ...(paid ? { status: "paid", paidAt: new Date(), paymentMethod: applied > 0 ? "prepaid_credit" : "estimate_deposit" } : {}),
      }).returning();
      if (applied > 0) await tx.insert(customerCreditsTable).values({
        tenantId: input.tenantId, customerId: input.customerId, amount: -applied / 100,
        kind: "invoice_application", reference: `Prepaid credit applied to ${invoice.invoiceNumber}`,
        invoiceId: invoice.id, requestId: `invoice:${invoice.id}`,
      });
      if (claimJob && input.jobId) await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, input.jobId));
      return [invoice];
    });
    return Object.assign(promise, { returning: (..._args: unknown[]) => promise });
  } };
}
