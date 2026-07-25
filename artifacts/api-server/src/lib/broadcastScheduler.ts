/**
 * Broadcast Scheduler
 * Picks up broadcasts with status='scheduled' whose scheduledFor time has arrived
 * and dispatches them. Runs every minute.
 *
 * Idempotency: uses an atomic conditional UPDATE (status='scheduled' AND scheduledFor <= now)
 * to claim each broadcast before dispatching, preventing duplicate sends in multi-instance deployments.
 */

import { db, broadcastsTable, broadcastRecipientsTable, customersTable, tenantsTable, communicationsLogTable, usersTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { resolveRecipients } from "../routes/broadcasts";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, type EmailProviderConfig } from "./emailProvider";

/**
 * Sends an alert email to the tenant owner when a scheduled broadcast lands in 'failed' status.
 * Resolves the owner email from businessEmail on the tenant, falling back to the first user with
 * role='owner'. Silently skips if no email address can be found.
 */
export async function notifyBroadcastFailed(
  tenantId: number,
  broadcastId: number,
  sent: number,
  failed: number,
  errorMessage?: string,
): Promise<void> {
  try {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (!tenant) return;

    // Resolve owner email: prefer businessEmail on the tenant record, fall back to owner user.
    let ownerEmail: string | null = tenant.businessEmail ?? null;
    if (!ownerEmail) {
      const [ownerUser] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner")))
        .limit(1);
      ownerEmail = ownerUser?.email ?? null;
    }

    if (!ownerEmail) {
      logger.warn({ tenantId, broadcastId }, "Broadcast failed alert: no owner email found, skipping notification");
      return;
    }

    const companyName = tenant.name ?? "Your company";
    const subject = `Action required: Scheduled broadcast #${broadcastId} failed to send`;
    const body = [
      `Hi,`,
      ``,
      `A scheduled broadcast (ID: ${broadcastId}) from ${companyName} failed to send.`,
      ``,
      sent > 0
        ? `Partial send: ${sent} message(s) delivered, ${failed} failed.`
        : `No messages were delivered (${failed} failed).`,
      ``,
      errorMessage ? `Error: ${errorMessage}` : null,
      ``,
      `To review the send history or resend, go to the Broadcasts page in ${companyName} OS and find broadcast #${broadcastId}.`,
      ``,
      `— ${companyName} automated alert`,
    ].filter((l): l is string => l !== null).join("\n");

    const emailProviderConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as EmailProviderConfig["provider"]) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };

    const result = await sendEmail(emailProviderConfig, ownerEmail, subject, body);
    if (!result.success) {
      logger.warn({ tenantId, broadcastId, error: result.error }, "Broadcast failed alert: email send failed");
    } else {
      logger.info({ tenantId, broadcastId, ownerEmail }, "Broadcast failed alert: notification sent to owner");
    }
  } catch (err) {
    logger.error({ tenantId, broadcastId, err }, "Broadcast failed alert: exception sending notification");
  }
}

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

  const finalStatus = failed > 0 && sent === 0 ? "failed" : "completed";
  await db.update(broadcastsTable)
    .set({ status: finalStatus, sentAt: new Date(), stats: { sent, failed, optedOut: 0 } })
    .where(eq(broadcastsTable.id, broadcastId));

  // Notify staff on full failure OR partial failure (some sent, some failed)
  if (failed > 0) {
    await notifyBroadcastFailed(tenantId, broadcastId, sent, failed);
  }
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
      await notifyBroadcastFailed(
        broadcast.tenantId,
        broadcast.id,
        0,
        0,
        err instanceof Error ? err.message : "Unexpected error during dispatch",
      );
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
