import { db, tenantsTable, servicesTable, customersTable, jobsTable, estimatesTable, invoicesTable } from "@workspace/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import { firstMatchingDepositRule, validateDepositRules, type DepositRule } from "./companyDepositRules";
import { creditBalance, creditedInvoiceInsert, invoiceBalance } from "./customerCredit";
import { invoiceDocumentDefaults } from "./invoiceDocumentDefaults";
import { randomUUID } from "node:crypto";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PaymentPolicy = { depositType: "none" | "fixed" | "percent" | "full" | null; depositValue: number | null; requirePrepay: boolean | null; requireCard: boolean | null };
export const emptyPaymentPolicy: PaymentPolicy = { depositType: null, depositValue: null, requirePrepay: null, requireCard: null };
export function normalizePaymentPolicy(value: unknown): PaymentPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...emptyPaymentPolicy };
  const p = value as Partial<PaymentPolicy>;
  return { depositType: p.depositType ?? null, depositValue: p.depositValue ?? null, requirePrepay: p.requirePrepay ?? null, requireCard: p.requireCard ?? null };
}
export function resolvePaymentPolicy(company: PaymentPolicy, service: PaymentPolicy, customer: PaymentPolicy): PaymentPolicy {
  const deposit = [customer, service, company].find(p => p.depositType !== null);
  return { depositType: deposit?.depositType ?? "none", depositValue: deposit?.depositValue ?? null,
    requirePrepay: company.requirePrepay === true || (customer.requirePrepay ?? service.requirePrepay ?? false),
    requireCard: company.requireCard === true || (customer.requireCard ?? service.requireCard ?? false) };
}
export async function effectivePaymentPolicy(tx: Tx | typeof db, tenantId: number, customerId?: number | null, serviceId?: number | null,
  context?: { total?: number; subtotal?: number; serviceIds?: number[] }) {
  const [company] = await tx.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [customer] = customerId ? await tx.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId))) : [];
  const serviceIds = [...new Set([...(context?.serviceIds ?? []), ...(serviceId ? [serviceId] : [])])].filter(id => Number.isInteger(id) && id > 0);
  const services = serviceIds.length ? await tx.select().from(servicesTable).where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.tenantId, tenantId))) : [];
  const raw = company?.paymentPolicy as (PaymentPolicy & { depositRules?: DepositRule[] }) | null;
  const rules = raw?.depositRules ?? [];
  const ruleError = validateDepositRules(rules);
  if (ruleError) throw new Error(`Company deposit rules need correction: ${ruleError}`);
  const total = context?.total ?? (context?.subtotal !== undefined ? context.subtotal * (1 + (company?.taxRate ?? 0) / 100) : undefined);
  const matchedRule = firstMatchingDepositRule(rules, total, services.map(service => service.id));
  const companyPolicy = normalizePaymentPolicy(raw);
  if (matchedRule) { companyPolicy.depositType = matchedRule.depositType; companyPolicy.depositValue = matchedRule.depositValue; }
  const servicePolicies = services.map(service => normalizePaymentPolicy(service.paymentPolicy));
  const amount = (policy: PaymentPolicy) => policy.depositType === "full" ? total ?? 1 : policy.depositType === "percent"
    ? (total ?? 1) * (policy.depositValue ?? 0) / 100 : policy.depositType === "fixed" ? policy.depositValue ?? 0 : 0;
  const servicePolicy = servicePolicies.filter(policy => policy.depositType !== null).sort((a, b) => amount(b) - amount(a))[0] ?? { ...emptyPaymentPolicy };
  servicePolicy.requireCard = servicePolicies.some(policy => policy.requireCard === true) ? true : servicePolicies.some(policy => policy.requireCard === false) ? false : null;
  servicePolicy.requirePrepay = servicePolicies.some(policy => policy.requirePrepay === true) ? true : servicePolicies.some(policy => policy.requirePrepay === false) ? false : null;
  const customerPolicy = normalizePaymentPolicy(customer?.paymentPolicy);
  return { policy: resolvePaymentPolicy(companyPolicy, servicePolicy, customerPolicy), customer, company, matchedRule,
    depositConfigured: customerPolicy.depositType !== null || servicePolicy.depositType !== null || companyPolicy.depositType !== null };
}

/** Re-evaluate unpaid/open quotes against current rules; paid/accepted history stays fixed. */
export async function estimatePaymentTerms(tx: Tx | typeof db, estimate: typeof estimatesTable.$inferSelect,
  selection?: { total: number; lineItems: unknown[] }) {
  if (estimate.depositPaidAt || !["draft", "sent"].includes(estimate.status)) return estimate;
  const items = (selection?.lineItems ?? estimate.lineItems ?? []) as { serviceId?: number; isOptional?: boolean; acceptedByCustomer?: boolean }[];
  const total = selection?.total ?? estimate.total;
  const { policy, depositConfigured } = await effectivePaymentPolicy(tx, estimate.tenantId, estimate.customerId, null,
    { total, serviceIds: items.filter(item => !item.isOptional || item.acceptedByCustomer).map(item => item.serviceId!).filter(Boolean) });
  if (!depositConfigured && !policy.requirePrepay) return estimate;
  const paymentRequirement = policy.requirePrepay || policy.depositType === "full" ? "full" : policy.depositType === "fixed"
    ? "deposit_fixed" : policy.depositType === "percent" ? "deposit_pct" : "none";
  return { ...estimate, paymentRequirement: total > 0 ? paymentRequirement : "none",
    depositValue: paymentRequirement === "deposit_fixed" ? Math.min(policy.depositValue ?? 0, total)
      : paymentRequirement === "deposit_pct" ? policy.depositValue : null };
}
export class SchedulingPaymentError extends Error { status = 422; }
export async function schedulingPaymentCheck(tx: Tx, input: typeof jobsTable.$inferInsert) {
  const { policy, customer, company } = await effectivePaymentPolicy(tx, input.tenantId, input.customerId, input.serviceId, { subtotal: input.totalAmount ?? 0 });
  if (!policy.requirePrepay && !policy.requireCard && policy.depositType === "none" && !input.estimateId) return { reserveCredit: false, total: 0 };
  if (!customer) throw new SchedulingPaymentError("A customer is required before scheduling under this payment policy");
  await tx.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customer.id)).for("update");
  if (policy.requireCard && (!customer.stripeDefaultPaymentMethodId || customer.cardExpiresAt && customer.cardExpiresAt < new Date().toISOString().slice(0, 10))) {
    throw new SchedulingPaymentError("A valid saved credit card is required on this customer's account before scheduling");
  }
  const total = Math.round((input.totalAmount ?? 0) * (1 + (company?.taxRate ?? 0) / 100) * 100) / 100;
  let depositRequired = policy.depositType === "full" ? total : policy.depositType === "percent" ? total * (policy.depositValue ?? 0) / 100 : policy.depositType === "fixed" ? policy.depositValue ?? 0 : 0;
  let depositReceived = 0;
  if (input.estimateId) {
    const [estimate] = await tx.select().from(estimatesTable).where(and(eq(estimatesTable.id, input.estimateId), eq(estimatesTable.tenantId, input.tenantId), eq(estimatesTable.customerId, customer.id)));
    if (estimate) {
      const estimateRequirement = estimate.paymentRequirement;
      if (estimateRequirement === "full") depositRequired = Math.max(depositRequired, estimate.total);
      if (estimateRequirement === "deposit_fixed") depositRequired = Math.max(depositRequired, estimate.depositValue ?? 0);
      if (estimateRequirement === "deposit_pct") depositRequired = Math.max(depositRequired, estimate.total * (estimate.depositValue ?? 0) / 100);
      const used = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(and(eq(invoicesTable.depositEstimateId, estimate.id), sql`${invoicesTable.status} NOT IN ('void','cancelled')`));
      if (estimate.depositPaidAt && !used.length) depositReceived = estimate.depositChargedAmount ?? 0;
    }
  }
  const invoices = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.tenantId, input.tenantId),
    input.invoiceId ? eq(invoicesTable.id, input.invoiceId) : input.planId ? eq(invoicesTable.planId, input.planId) : sql`false`));
  if (invoices.some(invoice => invoice.customerId === customer.id &&
    (!input.planId || invoice.planPeriodStart && invoice.planPeriodEnd &&
      new Date(input.scheduledAt!) >= invoice.planPeriodStart && new Date(input.scheduledAt!) < invoice.planPeriodEnd) &&
    (input.planId || invoice.total >= total) &&
    (invoice.status === "paid" || invoiceBalance(invoice) === 0 && (invoice.creditApplied > 0 || invoice.depositApplied > 0)))) return { reserveCredit: false, total };
  if (input.planId && (policy.requirePrepay || depositRequired > 0 || ["percent","full"].includes(policy.depositType ?? ""))) {
    throw new SchedulingPaymentError("The plan invoice covering this visit must be paid before scheduling. Older paid plan periods do not cover a new period");
  }
  if (["percent","full"].includes(policy.depositType ?? "") && !(total > 0)) throw new SchedulingPaymentError("Set a positive job price or pay the plan invoice before scheduling under this deposit requirement");
  if (policy.requirePrepay) {
    if (!(total > 0)) throw new SchedulingPaymentError("Set a positive job price before scheduling under the prepayment requirement");
    if (Math.round(depositReceived * 100) >= Math.round(total * 100)) return { reserveCredit: true, total };
    const available = await creditBalance(tx, input.tenantId, customer.id);
    if (Math.round((available + depositReceived) * 100) < Math.round(total * 100)) throw new SchedulingPaymentError("Full prepayment is required before this job can be scheduled. Record received payment or collect payment first");
    return { reserveCredit: true, total };
  }
  if (depositRequired > 0 && Math.round(depositReceived * 100) < Math.round(depositRequired * 100)) throw new SchedulingPaymentError("The required estimate deposit must be received before this job can be scheduled");
  return { reserveCredit: false, total };
}
export async function ensureScheduledJobPayment(tx: Tx, job: typeof jobsTable.$inferSelect) {
  const check = await schedulingPaymentCheck(tx, job);
  if (!check.reserveCredit) return job;
  const subtotal = job.totalAmount;
  const [invoice] = await creditedInvoiceInsert(tx, true).values({
    ...await invoiceDocumentDefaults(job.tenantId), tenantId: job.tenantId, customerId: job.customerId!,
    jobId: job.id, invoiceNumber: `INV-${randomUUID().slice(0,12)}`, status: "draft",
    subtotal, tax: check.total - subtotal, total: check.total,
    lineItems: [{ description: job.title, quantity: 1, unitPrice: subtotal, total: subtotal }],
  }).returning();
  if (invoiceBalance(invoice) > 0) throw new SchedulingPaymentError("Prepayment changed during scheduling; no job was scheduled");
  return { ...job, invoiceId: invoice.id };
}
/** Every production job insertion goes through the same transactional scheduling/payment boundary. */
export function paymentGuardedJobInsert(handle: Tx | typeof db) {
  return { values(input: typeof jobsTable.$inferInsert) {
    const promise = handle.transaction(async tx => {
      // Historical completed/cancelled imports do not place work on the schedule.
      if (["completed","cancelled"].includes(input.status ?? "")) return tx.insert(jobsTable).values(input).returning();
      await schedulingPaymentCheck(tx, input);
      const [job] = await tx.insert(jobsTable).values(input).returning();
      return [await ensureScheduledJobPayment(tx, job)];
    });
    return Object.assign(promise, { returning: (..._args: unknown[]) => promise });
  } };
}
