/**
 * Plan Scheduler
 * Runs daily and handles two automation pipelines for customer_plans:
 *   1. Job generation — advances each active plan's per-service look-ahead
 *      window, creating new plan-visit jobs (with geographic clustering) as
 *      the window rolls forward.
 *   2. Renewals — auto-renews plans whose current period is ending (billing
 *      + extending the period + notifying the customer), or sends a manual
 *      renewal reminder when auto-renew is off.
 */

import { db, customerPlansTable, jobsTable, usersTable, propertiesTable, customersTable, activityLogTable, tenantsTable, stopServiceFlagsTable, invoicesTable, servicesTable, planTemplatesTable } from "@workspace/db";
import { eq, and, sql, ne, inArray, lt, isNotNull, gt } from "drizzle-orm";
import { isInOffSeason, firstDayAfterOffSeason } from "./offSeasonUtils";
import { logger } from "./logger";
import { sendEmail } from "./emailProvider";
import { snapToCluster, billingCycleDays, type ClusterCandidate } from "./planSchedulingEngine";
import { billPlanPeriod, resolvePlanCurrentPrice } from "../routes/servicePlans";

const LOOKAHEAD_DAYS = parseInt(process.env.PLAN_LOOKAHEAD_DAYS ?? "60", 10);
const MAX_VISITS_PER_SERVICE_PER_RUN = 6; // safety cap against runaway generation

interface ServiceStateEntry {
  serviceId: number;
  serviceName: string;
  frequencyDays: number;
  lastScheduledAt: string | null;
}

function makeClusterLookup(tenantId: number) {
  return async (serviceId: number): Promise<ClusterCandidate[]> => {
    const rows = await db
      .select({
        id: jobsTable.id,
        scheduledAt: jobsTable.scheduledAt,
        assigneeId: jobsTable.assigneeId,
        assigneeName: usersTable.name,
        lat: propertiesTable.lat,
        lng: propertiesTable.lng,
      })
      .from(jobsTable)
      .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.serviceId, serviceId),
        eq(jobsTable.status, "scheduled"),
      ));
    return rows.map(r => ({ jobId: r.id, scheduledAt: r.scheduledAt, assigneeId: r.assigneeId, assigneeName: r.assigneeName, lat: r.lat, lng: r.lng }));
  };
}

async function generateVisitsForPlan(plan: typeof customerPlansTable.$inferSelect): Promise<number> {
  const lookahead = new Date(Date.now() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const serviceState = ((plan.serviceState as unknown[]) ?? []) as ServiceStateEntry[];
  if (serviceState.length === 0) return 0;

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, plan.propertyId));
  const lookupClusterCandidates = makeClusterLookup(plan.tenantId);

  // Pre-load off-season data for every service referenced by this plan
  const serviceIds = serviceState.map(s => s.serviceId);
  const serviceRows = serviceIds.length > 0
    ? await db.select({ id: servicesTable.id, offSeasonStart: servicesTable.offSeasonStart, offSeasonEnd: servicesTable.offSeasonEnd })
        .from(servicesTable)
        .where(inArray(servicesTable.id, serviceIds))
    : [];
  const svcOffSeasonMap = new Map(serviceRows.map(s => [s.id, s]));

  let generated = 0;
  const nextState: ServiceStateEntry[] = [];

  for (const svc of serviceState) {
    const svcRecord = svcOffSeasonMap.get(svc.serviceId);

    // `cursor` tracks the last occurrence date on the frequency rule (not the
    // clustered/snapped date), so each iteration always advances forward by
    // exactly `frequencyDays` regardless of where a visit actually landed.
    let cursor = svc.lastScheduledAt ? new Date(svc.lastScheduledAt) : new Date(plan.startDate);
    let iterations = 0;

    while (iterations < MAX_VISITS_PER_SERVICE_PER_RUN) {
      let idealDate = new Date(cursor.getTime() + svc.frequencyDays * 24 * 60 * 60 * 1000);

      // Off-season: if the ideal date falls in the service's off-season window,
      // jump forward to the first day after the off-season ends instead.
      if (svcRecord?.offSeasonStart && svcRecord?.offSeasonEnd &&
          isInOffSeason(idealDate, svcRecord.offSeasonStart, svcRecord.offSeasonEnd)) {
        idealDate = firstDayAfterOffSeason(idealDate, svcRecord.offSeasonEnd);
      }

      if (idealDate > lookahead) break;
      if (idealDate > plan.endDate) break; // this period's visits are already generated at sale/renewal time

      const candidates = await lookupClusterCandidates(svc.serviceId);
      const snapped = await snapToCluster(candidates, idealDate, 3, 2414, property?.lat ?? null, property?.lng ?? null);

      // Guard against duplicate generation (e.g. a retried run) — skip if a
      // job for this plan/service/date already exists.
      const [existing] = await db
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(and(eq(jobsTable.planId, plan.id), eq(jobsTable.serviceId, svc.serviceId), eq(jobsTable.scheduledAt, snapped.date)))
        .limit(1);

      if (!existing) {
        await db.insert(jobsTable).values({
          tenantId: plan.tenantId,
          title: `${svc.serviceName} — Plan Visit`,
          status: "scheduled",
          priority: "normal",
          customerId: plan.customerId,
          propertyId: plan.propertyId,
          assigneeId: snapped.assigneeId,
          serviceId: svc.serviceId,
          planId: plan.id,
          scheduledAt: snapped.date,
        });
        generated++;
      }

      // Advance the cursor by the ideal (unsnapped) date so the cadence stays
      // correct even when a visit was clustered onto a different day.
      cursor = idealDate;
      iterations++;
    }

    nextState.push({ ...svc, lastScheduledAt: cursor.toISOString() });
  }

  if (generated > 0) {
    await db.update(customerPlansTable).set({ serviceState: nextState }).where(eq(customerPlansTable.id, plan.id));
    logger.info({ planId: plan.id, generated }, "Plan scheduler: generated plan visits");
  }
  return generated;
}

async function processJobGeneration() {
  const activePlans = await db.select().from(customerPlansTable).where(eq(customerPlansTable.status, "active"));
  let totalGenerated = 0;
  for (const plan of activePlans) {
    try {
      totalGenerated += await generateVisitsForPlan(plan);
    } catch (err) {
      logger.error({ err, planId: plan.id }, "Plan scheduler: failed to generate visits");
    }
  }
  if (totalGenerated > 0) logger.info({ totalGenerated }, "Plan scheduler: job generation pass complete");
}

export async function processRenewals() {
  const today = new Date().toISOString().slice(0, 10);
  const duePlans = await db.select().from(customerPlansTable).where(and(
    eq(customerPlansTable.status, "active"),
    sql`${customerPlansTable.nextBillingDate} <= ${today}`,
  ));

  for (const plan of duePlans) {
    if (!plan.autoRenew) continue; // manual renewal path only
    try {
      const periodDays = billingCycleDays(plan.billingCycle, plan.customCycleDays);
      const newEndDate = new Date(plan.endDate.getTime() + periodDays * 24 * 60 * 60 * 1000);
      const newNextBillingDate = newEndDate.toISOString().slice(0, 10);

      // Resolve the current price for area-based plans so the renewal invoice
      // reflects the property's current measurements, not the stale sale price.
      const { resolvedPrice, areaNote, pricingMode } = await resolvePlanCurrentPrice(
        plan.tenantId, plan.templateId, plan.propertyId,
      );
      const billingOptions = pricingMode !== "flat" ? { resolvedPrice, areaNote } : undefined;

      // Persist the updated billingPrice on the plan if it drifted.
      if (pricingMode !== "flat" && resolvedPrice !== plan.billingPrice) {
        await db.update(customerPlansTable)
          .set({ billingPrice: resolvedPrice })
          .where(eq(customerPlansTable.id, plan.id));
        logger.info(
          { planId: plan.id, oldPrice: plan.billingPrice, newPrice: resolvedPrice, pricingMode },
          "Plan scheduler: updated billingPrice for area-based plan on renewal",
        );
      }

      const { invoiceId } = await billPlanPeriod(plan.tenantId, plan.id, 1, billingOptions);

      await db.update(customerPlansTable)
        .set({ endDate: newEndDate, nextBillingDate: newNextBillingDate, renewalReminderSentAt: null })
        .where(eq(customerPlansTable.id, plan.id));

      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, plan.customerId));
      if (customer?.email) {
        await sendEmail(
          { provider: null, config: {}, fromAddress: null },
          customer.email,
          `Your ${plan.templateName} plan has renewed`,
          `Hi ${customer.name},\n\nYour "${plan.templateName}" plan has automatically renewed for another ${plan.billingCycle} period. An invoice has been sent to you separately.\n\nThank you for your continued business.`,
        ).catch(err => logger.warn({ err, planId: plan.id }, "Plan renewal notification email failed"));
      }

      await db.insert(activityLogTable).values({
        tenantId: plan.tenantId, userId: 1, type: "plan_auto_renewed",
        message: `Plan "${plan.templateName}" auto-renewed (invoice ${invoiceId})`,
        entityId: plan.id,
      });

      logger.info({ planId: plan.id, invoiceId }, "Plan scheduler: auto-renewed plan");
    } catch (err) {
      logger.error({ err, planId: plan.id }, "Plan scheduler: auto-renewal failed");
    }
  }
}

async function processRenewalReminders() {
  const plans = await db.select().from(customerPlansTable).where(and(
    eq(customerPlansTable.status, "active"),
    eq(customerPlansTable.autoRenew, false),
  ));

  const now = new Date();
  for (const plan of plans) {
    if (plan.renewalReminderSentAt) continue;
    const daysUntilExpiry = Math.floor((plan.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry > plan.renewalReminderDaysBefore) continue;
    if (daysUntilExpiry < 0) continue; // already expired — office should manually resolve, not silently remind

    try {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, plan.customerId));
      if (customer?.email) {
        await sendEmail(
          { provider: null, config: {}, fromAddress: null },
          customer.email,
          `Your ${plan.templateName} plan is expiring soon`,
          `Hi ${customer.name},\n\nYour "${plan.templateName}" plan is set to expire on ${plan.endDate.toISOString().slice(0, 10)}. Contact us to renew and keep your service going without interruption.`,
        ).catch(err => logger.warn({ err, planId: plan.id }, "Renewal reminder email failed"));
      }
      await db.update(customerPlansTable).set({ renewalReminderSentAt: new Date(), status: "pending_renewal" }).where(eq(customerPlansTable.id, plan.id));
      logger.info({ planId: plan.id }, "Plan scheduler: sent renewal reminder");
    } catch (err) {
      logger.error({ err, planId: plan.id }, "Plan scheduler: renewal reminder failed");
    }
  }
}

/**
 * Detects plan-generated invoices that have crossed the tenant's stop-service
 * overdue threshold, automatically pauses the associated plan, cancels its
 * upcoming scheduled visits, creates a stop-service flag for office review,
 * and notifies admin/office users by email.
 *
 * Idempotent: skips any plan whose overdue invoice already has a pending flag.
 *
 * Exported for testing.
 */
export async function processOverduePlanFlags() {
  // Load all plans that are still generating visits / getting billed.
  const eligiblePlans = await db.select().from(customerPlansTable).where(
    inArray(customerPlansTable.status, ["active", "pending_renewal"]),
  );
  if (eligiblePlans.length === 0) return;

  // Fetch stop-service config for every involved tenant in one query.
  const tenantIds = [...new Set(eligiblePlans.map(p => p.tenantId))];
  const tenants = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      stopServiceRuleEnabled: tenantsTable.stopServiceRuleEnabled,
      stopServiceThresholdDays: tenantsTable.stopServiceThresholdDays,
    })
    .from(tenantsTable)
    .where(inArray(tenantsTable.id, tenantIds));
  const tenantMap = new Map(tenants.map(t => [t.id, t]));

  // Only process plans whose tenant has the stop-service rule switched on.
  const enabledPlans = eligiblePlans.filter(p => tenantMap.get(p.tenantId)?.stopServiceRuleEnabled);
  if (enabledPlans.length === 0) return;

  // Find overdue plan invoices for those plans (unpaid, dueDate in the past).
  const planIds = enabledPlans.map(p => p.id);
  const now = new Date();
  const overdueInvoices = await db.select().from(invoicesTable).where(and(
    inArray(invoicesTable.planId, planIds),
    ne(invoicesTable.status, "paid"),
    isNotNull(invoicesTable.dueDate),
    lt(invoicesTable.dueDate, now),
  ));
  if (overdueInvoices.length === 0) return;

  // Load existing pending flags to avoid creating duplicates.
  const overdueInvoiceIds = overdueInvoices.map(i => i.id);
  const existingFlags = await db
    .select({ invoiceId: stopServiceFlagsTable.invoiceId })
    .from(stopServiceFlagsTable)
    .where(and(
      inArray(stopServiceFlagsTable.invoiceId, overdueInvoiceIds),
      eq(stopServiceFlagsTable.status, "pending"),
    ));
  const flaggedInvoiceIds = new Set(existingFlags.map(f => f.invoiceId));

  // Build a plan-keyed map: planId → worst qualifying overdue invoice.
  // Processing at the plan level (not invoice level) ensures each plan is
  // paused at most once per run even if it has multiple overdue invoices.
  const planMap = new Map(enabledPlans.map(p => [p.id, p]));
  const worstInvoicePerPlan = new Map<number, typeof overdueInvoices[number]>();

  for (const invoice of overdueInvoices) {
    if (!invoice.planId) continue;
    const plan = planMap.get(invoice.planId);
    if (!plan) continue;
    const tenant = tenantMap.get(plan.tenantId);
    if (!tenant) continue;
    const thresholdDays = tenant.stopServiceThresholdDays ?? 30;
    const daysOverdue = Math.floor((now.getTime() - invoice.dueDate!.getTime()) / (1000 * 60 * 60 * 24));
    if (daysOverdue < thresholdDays) continue;

    // Keep the most-overdue invoice per plan (arbitrary but deterministic).
    const prev = worstInvoicePerPlan.get(invoice.planId);
    if (!prev || daysOverdue > Math.floor((now.getTime() - prev.dueDate!.getTime()) / (1000 * 60 * 60 * 24))) {
      worstInvoicePerPlan.set(invoice.planId, invoice);
    }
  }

  for (const [planId, invoice] of worstInvoicePerPlan) {
    const plan = planMap.get(planId)!;
    const tenant = tenantMap.get(plan.tenantId)!;
    const thresholdDays = tenant.stopServiceThresholdDays ?? 30;
    const daysOverdue = Math.floor((now.getTime() - invoice.dueDate!.getTime()) / (1000 * 60 * 60 * 24));

    try {
      // 1. Atomically pause the plan — only proceeds if status is still
      //    active or pending_renewal. If another process/run already paused
      //    it, the update returns 0 rows and we skip the rest.
      const updated = await db.update(customerPlansTable)
        .set({ status: "paused" })
        .where(and(
          eq(customerPlansTable.id, plan.id),
          inArray(customerPlansTable.status, ["active", "pending_renewal"]),
        ))
        .returning({ id: customerPlansTable.id });

      if (updated.length === 0) continue; // already paused — nothing more to do

      // 2. Cancel future scheduled plan visits so staff don't show up for a
      //    non-paying customer.
      await db.update(jobsTable)
        .set({ status: "cancelled" })
        .where(and(
          eq(jobsTable.tenantId, plan.tenantId),
          eq(jobsTable.planId, plan.id),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, now),
        ));

      // 3. Create a stop-service flag so the office queue surfaces this —
      //    but only if no pending flag already exists for this invoice
      //    (the payment-reminder scheduler may have already raised one).
      if (!flaggedInvoiceIds.has(invoice.id)) {
        await db.insert(stopServiceFlagsTable).values({
          tenantId: plan.tenantId,
          customerId: plan.customerId,
          invoiceId: invoice.id,
          daysOverdue,
          message: `Plan "${plan.templateName}" auto-paused: invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue (threshold: ${thresholdDays} days).`,
          status: "pending",
        });
      }

      // 4. Email every admin/office user on this tenant.
      const adminUsers = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(and(
          eq(usersTable.tenantId, plan.tenantId),
          inArray(usersTable.role, ["owner", "office"]),
        ));

      for (const admin of adminUsers) {
        await sendEmail(
          { provider: null, config: {}, fromAddress: null },
          admin.email,
          `Service plan auto-paused: overdue invoice for ${plan.templateName}`,
          `Hi ${admin.name},\n\nThe "${plan.templateName}" service plan (Plan #${plan.id}) has been automatically paused because invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue.\n\nA stop-service flag has been raised in your dashboard. Once the customer has paid, you can resume the plan from the Plans section.\n\n— ${tenant.name}`,
        ).catch(err => logger.warn({ err, planId: plan.id }, "Plan overdue pause notification email failed"));
      }

      // 5. Log for audit trail.
      await db.insert(activityLogTable).values({
        tenantId: plan.tenantId,
        userId: 1,
        type: "plan_auto_paused_overdue",
        message: `Plan "${plan.templateName}" auto-paused: invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue`,
        entityId: plan.id,
      });

      logger.info({ planId: plan.id, invoiceId: invoice.id, daysOverdue }, "Plan scheduler: auto-paused plan due to overdue invoice");
    } catch (err) {
      logger.error({ err, planId: plan.id, invoiceId: invoice.id }, "Plan scheduler: failed to auto-pause overdue plan");
    }
  }
}

async function runPlanCycle() {
  logger.info("Plan scheduler: starting daily cycle");
  await processJobGeneration();
  await processRenewals();
  await processRenewalReminders();
  await processOverduePlanFlags();
  logger.info("Plan scheduler: daily cycle complete");
}

export function startPlanScheduler() {
  logger.info("Starting plan scheduler (runs every 24 hours)");

  void runPlanCycle().catch(err => logger.error({ err }, "Plan scheduler error"));

  const interval = setInterval(() => {
    void runPlanCycle().catch(err => logger.error({ err }, "Plan scheduler error"));
  }, 24 * 60 * 60 * 1000);

  interval.unref();
}
