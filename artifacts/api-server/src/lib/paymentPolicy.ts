import { db, tenantsTable, servicesTable, customersTable, jobsTable, estimatesTable, invoicesTable } from "@workspace/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import { depositInvoiceSatisfied, depositRequiredBeforeSchedulingMessage, firstMatchingDepositRule, hasStoredEstimateDepositSettings, readEstimateDepositSettings, readScheduleDeposit, schedulingDepositTarget, unpaidScheduleDepositMessage, validateDepositRules, type DepositRule } from "./companyDepositRules";
import { creditBalance, creditedInvoiceInsert, invoiceBalance } from "./customerCredit";
import { enforceCrewCapacity,type CapacityApproval } from "./crewCapacity";
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
  const depositSettings = readEstimateDepositSettings(raw);
  const storedDepositSettings = hasStoredEstimateDepositSettings(raw);
  const rules = storedDepositSettings
    ? (depositSettings.enabled && depositSettings.allowEstimateOverrides ? depositSettings.rules : [])
    : raw?.depositRules ?? [];
  const ruleError = validateDepositRules(rules);
  if (ruleError) throw new Error(`Company deposit rules need correction: ${ruleError}`);
  const total = context?.total ?? (context?.subtotal !== undefined ? context.subtotal * (1 + (company?.taxRate ?? 0) / 100) : undefined);
  const matchedRule = firstMatchingDepositRule(rules, total, services.map(service => service.id));
  const companyPolicy = normalizePaymentPolicy(raw);
  if (storedDepositSettings) {
    companyPolicy.depositType = depositSettings.enabled ? depositSettings.defaultType : "none";
    companyPolicy.depositValue = depositSettings.enabled ? depositSettings.defaultAmount : null;
  }
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
  const { policy, depositConfigured, company } = await effectivePaymentPolicy(tx, estimate.tenantId, estimate.customerId, null,
    { total, serviceIds: items.filter(item => !item.isOptional || item.acceptedByCustomer).map(item => item.serviceId!).filter(Boolean) });
  const depositSettings = readEstimateDepositSettings(company?.paymentPolicy);
  if (estimate.depositOverride && depositSettings.enabled && depositSettings.allowEstimateOverrides) return estimate;
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
  const confirmingSchedule = !input.status || input.status === "scheduled" || input.status === "in_progress";
  const depositSettings = readEstimateDepositSettings(company?.paymentPolicy);
  const storedDepositSettings = hasStoredEstimateDepositSettings(company?.paymentPolicy);
  // Require Deposit Before Scheduling is tenants.payment_policy.estimate_deposit_settings.
  const scheduleDeposit = readScheduleDeposit(company?.paymentPolicy);
  const scheduleDepositApplies = confirmingSchedule && (storedDepositSettings
    ? depositSettings.enabled && depositSettings.requireBeforeScheduling
    : scheduleDeposit.enabled);
  if (!policy.requirePrepay && !policy.requireCard && policy.depositType === "none" && !input.estimateId && !scheduleDepositApplies) return { reserveCredit: false, total: 0 };
  if (!customer) throw new SchedulingPaymentError("A customer is required before scheduling under this payment policy");
  await tx.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customer.id)).for("update");
  if (policy.requireCard && (!customer.stripeDefaultPaymentMethodId || customer.stripeDefaultPaymentMethodType==="us_bank_account" || customer.cardExpiresAt && customer.cardExpiresAt < new Date().toISOString().slice(0, 10))) {
    throw new SchedulingPaymentError("A valid saved credit card is required on this customer's account before scheduling");
  }
  const total = Math.round((input.totalAmount ?? 0) * (1 + (company?.taxRate ?? 0) / 100) * 100) / 100;
  let depositRequired = policy.depositType === "full" ? total : policy.depositType === "percent" ? total * (policy.depositValue ?? 0) / 100 : policy.depositType === "fixed" ? policy.depositValue ?? 0 : 0;
  let depositReceived = 0;
  let estimateTotal = 0;
  if (input.estimateId) {
    const [estimate] = await tx.select().from(estimatesTable).where(and(eq(estimatesTable.id, input.estimateId), eq(estimatesTable.tenantId, input.tenantId), eq(estimatesTable.customerId, customer.id)));
    if (estimate) {
      estimateTotal = estimate.total ?? 0;
      const estimateRequirement = estimate.paymentRequirement;
      if (estimateRequirement === "full") depositRequired = Math.max(depositRequired, estimate.total);
      if (estimateRequirement === "deposit_fixed") depositRequired = Math.max(depositRequired, estimate.depositValue ?? 0);
      if (estimateRequirement === "deposit_pct") depositRequired = Math.max(depositRequired, estimate.total * (estimate.depositValue ?? 0) / 100);
      const depositInvoices = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.tenantId, input.tenantId), eq(invoicesTable.depositEstimateId, estimate.id), sql`${invoicesTable.status} NOT IN ('void','cancelled')`));
      const paidOnInvoice = depositInvoices.filter(invoice => depositInvoiceSatisfied(invoice)).reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);
      if (estimate.depositPaidAt) depositReceived = Math.max(depositReceived, estimate.depositChargedAmount ?? 0);
      if (paidOnInvoice > 0) depositReceived = Math.max(depositReceived, paidOnInvoice);
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
  const estimateDepositRequired = depositRequired;
  if (scheduleDepositApplies) {
    const basis = estimateTotal > 0 ? estimateTotal : total;
    const target = schedulingDepositTarget(scheduleDeposit.mode, scheduleDeposit.value, basis);
    const scheduleRequired = target.amount;
    const scheduleMessage = target.needsPrice && Math.round(depositReceived * 100) <= 0
      ? "Set a positive job or estimate total before scheduling. A percentage deposit is required."
      : scheduleRequired > 0 && Math.round(depositReceived * 100) < Math.round(scheduleRequired * 100)
        ? depositRequiredBeforeSchedulingMessage(scheduleRequired)
        : null;
    if (scheduleMessage && (scheduleRequired >= estimateDepositRequired || target.needsPrice)) throw new SchedulingPaymentError(scheduleMessage);
    if (scheduleRequired > depositRequired) depositRequired = scheduleRequired;
  }
  const enforceDeposit = !storedDepositSettings || (depositSettings.enabled && depositSettings.requireBeforeScheduling);
  if (enforceDeposit && depositRequired > 0 && Math.round(depositReceived * 100) < Math.round(depositRequired * 100)) throw new SchedulingPaymentError(depositRequiredBeforeSchedulingMessage(depositRequired));
  return { reserveCredit: false, total };
}
export type ScheduleDepositNotice = { message: string; amount: number; estimateId: number | null; invoiceId: number | null };

export async function jobScheduleDepositWarning(tenantId: number, job: { status: string; totalAmount: number; estimateId: number | null }): Promise<ScheduleDepositNotice | null> {
  if (["completed", "cancelled"].includes(job.status)) return null;
  const [company] = await db.select({ paymentPolicy: tenantsTable.paymentPolicy, taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const setting = readScheduleDeposit(company?.paymentPolicy);
  if (!setting.enabled) return null;
  let total = Math.round((job.totalAmount ?? 0) * (1 + (company?.taxRate ?? 0) / 100) * 100) / 100;
  let received = 0;
  let invoiceId: number | null = null;
  if (job.estimateId) {
    const [estimate] = await db.select({ total: estimatesTable.total, depositPaidAt: estimatesTable.depositPaidAt, depositChargedAmount: estimatesTable.depositChargedAmount }).from(estimatesTable).where(and(eq(estimatesTable.id, job.estimateId), eq(estimatesTable.tenantId, tenantId)));
    if (estimate) {
      total = Math.max(total, estimate.total ?? 0);
      if (estimate.depositPaidAt) received = estimate.depositChargedAmount ?? 0;
    }
    const depositInvoices = await db.select().from(invoicesTable).where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.depositEstimateId, job.estimateId), sql`${invoicesTable.status} NOT IN ('void','cancelled')`));
    const paid = depositInvoices.filter(invoice => depositInvoiceSatisfied(invoice)).reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);
    received = Math.max(received, paid);
    invoiceId = depositInvoices.find(invoice => !depositInvoiceSatisfied(invoice) && invoiceBalance(invoice) > 0)?.id ?? null;
  }
  const message = unpaidScheduleDepositMessage(setting, total, received);
  if (!message) return null;
  const amount = schedulingDepositTarget(setting.mode, setting.value, total).amount;
  return { message: depositRequiredBeforeSchedulingMessage(amount || total), amount: amount || total, estimateId: job.estimateId, invoiceId };
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
export function paymentGuardedJobInsert(handle: Tx | typeof db,capacity:CapacityApproval={}) {
  return { values(input: typeof jobsTable.$inferInsert) {
    const promise = handle.transaction(async tx => {
      // Historical completed/cancelled imports do not place work on the schedule.
      if (["completed","cancelled"].includes(input.status ?? "")) return tx.insert(jobsTable).values(input).returning();
      const checked=await enforceCrewCapacity(tx,input,capacity);
      await schedulingPaymentCheck(tx, checked);
      const [job] = await tx.insert(jobsTable).values(checked).returning();
      return [await ensureScheduledJobPayment(tx, job)];
    });
    return Object.assign(promise, { returning: (..._args: unknown[]) => promise });
  } };
}
