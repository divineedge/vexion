/**
 * Broadcast Scheduler
 * Picks up broadcasts with status='scheduled' whose scheduledFor time has arrived
 * and dispatches them. Runs every minute.
 *
 * Idempotency: uses an atomic conditional UPDATE (status='scheduled' AND scheduledFor <= now)
 * to claim each broadcast before dispatching, preventing duplicate sends in multi-instance deployments.
 */

import { db, broadcastsTable, broadcastRecipientsTable, customersTable, tenantsTable, communicationsLogTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { resolveRecipients } from "../routes/broadcasts";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, type EmailProviderConfig } from "./emailProvider";

async function claimScheduledBroadcast(broadcastId: number): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(broadcastsTable)
    .set({ status: "sending" })
    .where(
      and(
        eq(broadcastsTable.id, broadcastId),
        eq(broadcastsTable.status, "scheduled"),
        lte(broadcastsTable.scheduledFor, now),
      )
    )
    .returning({ id: broadcastsTable.id });
  return result.length > 0;
}

async function dispatchBroadcast(
  tenantId: number,
  broadcastId: number,
  channel: "sms" | "email",
  subject: string | null,
  body: string,
  recipients: (typeof customersTable.$inferSelect)[],
) {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  let sent = 0;
  let failed = 0;

  for (const customer of recipients) {
    const personalized = body.replace(/\{\{\s*name\s*\}\}/gi, customer.name.split(" ")[0] ?? customer.name);
    try {
      if (channel === "sms") {
        const smsConfig: SmsProviderConfig = {
          platform: (tenant?.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
          config: (tenant?.phonePlatformConfig as Record<string, string>) ?? {},
          fromNumber: tenant?.marketingPhoneNumber ?? tenant?.mainPhoneNumber ?? null,
        };
        const result = await sendSms(smsConfig, customer.phone, personalized);
        await db.insert(communicationsLogTable).values({
          tenantId, customerId: customer.id, direction: "outbound", channel: "sms",
          toAddress: customer.phone, body: personalized,
          status: result.success ? "sent" : "failed", externalId: result.externalId ?? null, messageType: "broadcast",
        });
        await db.insert(broadcastRecipientsTable).values({ tenantId, broadcastId, customerId: customer.id, status: result.success ? "sent" : "failed", error: result.error ?? null });
        result.success ? sent++ : failed++;
      } else {
        const emailConfig: EmailProviderConfig = {
          provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
          config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };
        const result = await sendEmail(emailConfig, customer.email, subject ?? "", personalized);
        await db.insert(communicationsLogTable).values({
          tenantId, customerId: customer.id, direction: "outbound", channel: "email",
          toAddress: customer.email, subject: subject ?? "", body: personalized,
          status: result.success ? "sent" : "failed", externalId: result.externalId ?? null, messageType: "broadcast",
        });
        await db.insert(broadcastRecipientsTable).values({ tenantId, broadcastId, customerId: customer.id, status: result.success ? "sent" : "failed", error: result.error ?? null });
        result.success ? sent++ : failed++;
      }
    } catch (err) {
      failed++;
      logger.warn({ err, customerId: customer.id, broadcastId }, "Scheduled broadcast recipient send failed");
      await db.insert(broadcastRecipientsTable).values({ tenantId, broadcastId, customerId: customer.id, status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  await db.update(broadcastsTable)
    .set({ status: failed > 0 && sent === 0 ? "failed" : "completed", sentAt: new Date(), stats: { sent, failed, optedOut: 0 } })
    .where(eq(broadcastsTable.id, broadcastId));
}

async function processScheduledBroadcasts() {
  const now = new Date();

  // Find all due scheduled broadcasts
  const due = await db
    .select()
    .from(broadcastsTable)
    .where(
      and(
        eq(broadcastsTable.status, "scheduled"),
        lte(broadcastsTable.scheduledFor, now),
      )
    );

  for (const broadcast of due) {
    const claimed = await claimScheduledBroadcast(broadcast.id);
    if (!claimed) continue; // Another instance claimed it

    logger.info({ broadcastId: broadcast.id, scheduledFor: broadcast.scheduledFor }, "Dispatching scheduled broadcast");

    try {
      // Re-resolve recipients at send time to respect any new opt-outs
      const recipients = await resolveRecipients(
        broadcast.tenantId,
        broadcast.channel as "sms" | "email",
        (broadcast.recipientFilter as Record<string, unknown>) ?? {},
      );

      await dispatchBroadcast(
        broadcast.tenantId,
        broadcast.id,
        broadcast.channel as "sms" | "email",
        broadcast.subject ?? null,
        broadcast.body,
        recipients,
      );
    } catch (err) {
      logger.error({ err, broadcastId: broadcast.id }, "Scheduled broadcast dispatch crashed");
      await db.update(broadcastsTable)
        .set({ status: "failed" })
        .where(eq(broadcastsTable.id, broadcast.id));
    }
  }
}

export function startBroadcastScheduler() {
  logger.info("Starting broadcast scheduler (runs every minute)");

  // Run immediately on startup, then every minute
  void processScheduledBroadcasts().catch(err => logger.error({ err }, "Broadcast scheduler error"));

  const interval = setInterval(() => {
    void processScheduledBroadcasts().catch(err => logger.error({ err }, "Broadcast scheduler error"));
  }, 60 * 1000);

  interval.unref();
}
