/**
 * Smart Follow-Up Queue Scheduler
 * Runs every hour and creates/repeats follow-up-queue items for tenants that have
 * the corresponding trigger enabled in `tenants.followupTriggerConfig`:
 *   - sentEstimate: estimate still 'sent' (not approved/declined) `delayDays` after sentAt
 *   - sentInvoice: invoice still unpaid `delayDays` after createdAt (or dueDate if earlier)
 *   - unansweredEmail: inbound email with no outbound reply within `hours`
 *
 * Missed-call / voicemail items are created immediately from the communications
 * webhook (see communications.ts), not by this poller.
 *
 * One open item is kept per (tenantId, triggerType, triggerContextId). If the item
 * is still open when the repeat interval elapses again, `lastRepeatedAt` is bumped
 * instead of inserting a duplicate row — the item never silently disappears, it
 * just keeps aging until an office user resolves it with a note.
 */

import { db, tenantsTable, estimatesTable, invoicesTable, communicationsLogTable, followupQueueItemsTable } from "@workspace/db";
import { eq, and, isNull, or, lte, ne, desc } from "drizzle-orm";
import { logger } from "./logger";

interface FollowupTriggerConfig {
  sentEstimate?: { enabled?: boolean; delayDays?: number; repeatDays?: number };
  sentInvoice?: { enabled?: boolean; delayDays?: number; repeatDays?: number };
  unansweredEmail?: { enabled?: boolean; hours?: number };
  missedCall?: { enabled?: boolean };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Insert a new open item, or bump lastRepeatedAt if one is already open for this trigger+context. */
async function upsertQueueItem(params: {
  tenantId: number;
  customerId: number;
  triggerType: string;
  triggerContextId: number;
  reason: string;
  repeatWindowMs: number;
}) {
  const { tenantId, customerId, triggerType, triggerContextId, reason, repeatWindowMs } = params;

  const [existing] = await db
    .select()
    .from(followupQueueItemsTable)
    .where(
      and(
        eq(followupQueueItemsTable.tenantId, tenantId),
        eq(followupQueueItemsTable.triggerType, triggerType),
        eq(followupQueueItemsTable.triggerContextId, triggerContextId),
        eq(followupQueueItemsTable.status, "open"),
      ),
    )
    .limit(1);

  if (existing) {
    const dueForRepeat = Date.now() - existing.lastRepeatedAt.getTime() >= repeatWindowMs;
    if (dueForRepeat) {
      await db.update(followupQueueItemsTable)
        .set({ lastRepeatedAt: new Date(), reason })
        .where(eq(followupQueueItemsTable.id, existing.id));
    }
    return;
  }

  await db.insert(followupQueueItemsTable).values({
    tenantId,
    customerId,
    triggerType,
    triggerContextId,
    reason,
    status: "open",
  });
}

async function processSentEstimates(tenantId: number, cfg: NonNullable<FollowupTriggerConfig["sentEstimate"]>) {
  const delayMs = (cfg.delayDays ?? 3) * DAY_MS;
  const repeatMs = (cfg.repeatDays ?? 3) * DAY_MS;
  const cutoff = new Date(Date.now() - delayMs);

  const rows = await db
    .select()
    .from(estimatesTable)
    .where(
      and(
        eq(estimatesTable.tenantId, tenantId),
        eq(estimatesTable.status, "sent"),
        lte(estimatesTable.sentAt, cutoff),
      ),
    );

  for (const estimate of rows) {
    if (!estimate.customerId || !estimate.sentAt) continue;
    const daysAgo = Math.floor((Date.now() - estimate.sentAt.getTime()) / DAY_MS);
    await upsertQueueItem({
      tenantId,
      customerId: estimate.customerId,
      triggerType: "sent_estimate",
      triggerContextId: estimate.id,
      reason: `Estimate #${estimate.id} sent ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago, no response yet`,
      repeatWindowMs: repeatMs,
    });
  }
}

async function processSentInvoices(tenantId: number, cfg: NonNullable<FollowupTriggerConfig["sentInvoice"]>) {
  const delayMs = (cfg.delayDays ?? 5) * DAY_MS;
  const repeatMs = (cfg.repeatDays ?? 5) * DAY_MS;
  const cutoff = new Date(Date.now() - delayMs);

  const rows = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.tenantId, tenantId),
        ne(invoicesTable.status, "paid"),
        ne(invoicesTable.status, "draft"),
        isNull(invoicesTable.paidAt),
        lte(invoicesTable.createdAt, cutoff),
      ),
    );

  for (const invoice of rows) {
    const daysAgo = Math.floor((Date.now() - invoice.createdAt.getTime()) / DAY_MS);
    await upsertQueueItem({
      tenantId,
      customerId: invoice.customerId,
      triggerType: "sent_invoice",
      triggerContextId: invoice.id,
      reason: `Invoice ${invoice.invoiceNumber} unpaid ${daysAgo} day${daysAgo === 1 ? "" : "s"} after sending`,
      repeatWindowMs: repeatMs,
    });
  }
}

async function processUnansweredEmails(tenantId: number, cfg: NonNullable<FollowupTriggerConfig["unansweredEmail"]>) {
  const hoursMs = (cfg.hours ?? 48) * HOUR_MS;
  const cutoff = new Date(Date.now() - hoursMs);

  const inboundEmails = await db
    .select()
    .from(communicationsLogTable)
    .where(
      and(
        eq(communicationsLogTable.tenantId, tenantId),
        eq(communicationsLogTable.direction, "inbound"),
        eq(communicationsLogTable.channel, "email"),
        lte(communicationsLogTable.createdAt, cutoff),
      ),
    );

  for (const inbound of inboundEmails) {
    if (!inbound.customerId) continue;

    // Has the office replied by email to this customer since the inbound message came in?
    const [reply] = await db
      .select({ id: communicationsLogTable.id })
      .from(communicationsLogTable)
      .where(
        and(
          eq(communicationsLogTable.tenantId, tenantId),
          eq(communicationsLogTable.customerId, inbound.customerId),
          eq(communicationsLogTable.direction, "outbound"),
          eq(communicationsLogTable.channel, "email"),
        ),
      )
      .orderBy(desc(communicationsLogTable.createdAt))
      .limit(1);

    if (reply) {
      // If the most recent outbound reply happened after this inbound message, it's answered.
      const [replyRow] = await db.select().from(communicationsLogTable).where(eq(communicationsLogTable.id, reply.id)).limit(1);
      if (replyRow && replyRow.createdAt > inbound.createdAt) continue;
    }

    const hoursAgo = Math.floor((Date.now() - inbound.createdAt.getTime()) / HOUR_MS);
    await upsertQueueItem({
      tenantId,
      customerId: inbound.customerId,
      triggerType: "unanswered_email",
      triggerContextId: inbound.id,
      reason: `Customer emailed ${hoursAgo}h ago with no reply sent`,
      repeatWindowMs: hoursMs,
    });
  }
}

async function processTenant(tenantId: number, cfg: FollowupTriggerConfig) {
  if (cfg.sentEstimate?.enabled) await processSentEstimates(tenantId, cfg.sentEstimate);
  if (cfg.sentInvoice?.enabled) await processSentInvoices(tenantId, cfg.sentInvoice);
  if (cfg.unansweredEmail?.enabled) await processUnansweredEmails(tenantId, cfg.unansweredEmail);
}

async function processAllTenants() {
  const tenants = await db.select({ id: tenantsTable.id, followupTriggerConfig: tenantsTable.followupTriggerConfig }).from(tenantsTable);

  for (const tenant of tenants) {
    const cfg = (tenant.followupTriggerConfig as FollowupTriggerConfig) ?? {};
    try {
      await processTenant(tenant.id, cfg);
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Follow-up scheduler failed for tenant");
    }
  }
}

export function startFollowupScheduler() {
  logger.info("Starting follow-up queue scheduler (runs every hour)");

  void processAllTenants().catch(err => logger.error({ err }, "Follow-up scheduler error"));

  const interval = setInterval(() => {
    void processAllTenants().catch(err => logger.error({ err }, "Follow-up scheduler error"));
  }, 60 * 60 * 1000);

  interval.unref();
}
