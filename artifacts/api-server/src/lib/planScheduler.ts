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

import { db, customerPlansTable, jobsTable, usersTable, propertiesTable, customersTable, activityLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendEmail } from "./emailProvider";
import { snapToCluster, billingCycleDays, type ClusterCandidate } from "./planSchedulingEngine";
import { billPlanPeriod } from "../routes/servicePlans";

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

  let generated = 0;
  const nextState: ServiceStateEntry[] = [];

  for (const svc of serviceState) {
    // `cursor` tracks the last occurrence date on the frequency rule (not the
    // clustered/snapped date), so each iteration always advances forward by
    // exactly `frequencyDays` regardless of where a visit actually landed.
    let cursor = svc.lastScheduledAt ? new Date(svc.lastScheduledAt) : new Date(plan.startDate);
    let iterations = 0;

    while (iterations < MAX_VISITS_PER_SERVICE_PER_RUN) {
      const idealDate = new Date(cursor.getTime() + svc.frequencyDays * 24 * 60 * 60 * 1000);
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

async function processRenewals() {
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

      const { invoiceId } = await billPlanPeriod(plan.tenantId, plan.id, 1);

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

async function runPlanCycle() {
  logger.info("Plan scheduler: starting daily cycle");
  await processJobGeneration();
  await processRenewals();
  await processRenewalReminders();
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
