/**
 * Card Expiry Reminder Scheduler
 * Runs once on startup, then every 24 hours.
 * For each customer whose saved card expires within 60 days and has not been
 * reminded in the last 25 days, sends an email (and SMS if configured) with a
 * link to their portal profile so they can update their card.
 */

import { db, customersTable, tenantsTable } from "@workspace/db";
import { eq, and, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, type EmailProviderConfig } from "./emailProvider";

async function processAllExpiring() {
  const now = new Date();
  // Cards expiring within 60 days
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60)
    .toISOString()
    .split("T")[0];
  // Don't re-send if reminded within the last 25 days
  const cooloffDate = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ customer: customersTable, tenant: tenantsTable })
    .from(customersTable)
    .innerJoin(tenantsTable, eq(customersTable.tenantId, tenantsTable.id))
    .where(
      and(
        isNotNull(customersTable.cardExpiresAt),
        sql`${customersTable.cardExpiresAt} <= ${cutoffDate}`,
        or(
          isNull(customersTable.cardExpiryReminderSentAt),
          lte(customersTable.cardExpiryReminderSentAt, cooloffDate),
        ),
      ),
    );

  logger.info({ count: rows.length }, "Card expiry reminder: processing customers");

  for (const { customer, tenant } of rows) {
    try {
      await sendExpiryReminderForCustomer(customer, tenant);
    } catch (err) {
      logger.error({ err, customerId: customer.id }, "Card expiry reminder failed for customer");
    }
  }
}

async function sendExpiryReminderForCustomer(
  customer: typeof customersTable.$inferSelect,
  tenant: typeof tenantsTable.$inferSelect,
) {
  // Build portal URL — prefer REPLIT_DEV_DOMAIN in dev; fall back to businessEmail domain
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  const portalUrl = devDomain
    ? `https://${devDomain}/portal/profile`
    : `https://${tenant.businessEmail?.split("@")[1] ?? "app"}/portal/profile`;

  const businessName = tenant.name ?? "your service provider";
  const firstName = customer.name?.split(" ")[0] ?? "there";

  const cardDate = customer.cardExpiresAt ? new Date(customer.cardExpiresAt) : null;
  const expLabel = cardDate
    ? ` expiring ${cardDate.toLocaleString("en-US", { month: "long", year: "numeric" })}`
    : "";

  const sent: string[] = [];

  // Email
  if (!customer.emailOptOut && customer.email) {
    const emailConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as EmailProviderConfig["provider"]) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    const html = `
      <p>Hi ${firstName},</p>
      <p>The payment card${expLabel} we have on file is expiring soon.
         Please update it to avoid any interruption to your service.</p>
      <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Update my payment card →</a></p>
      <p>Questions? Reply to this email or call us.<br>${businessName}</p>
    `;
    const subject = `Action needed: your payment card${expLabel} is expiring soon`;
    const text = `Hi ${firstName}, your card${expLabel} is expiring soon. Please update it here: ${portalUrl}`;
    const result = await sendEmail(emailConfig, customer.email, subject, text, html);
    if (result.success) sent.push("email");
    else logger.warn({ error: result.error, customerId: customer.id }, "Card expiry email failed");
  }

  // SMS
  if (!customer.smsOptOut && customer.phone) {
    const smsConfig: SmsProviderConfig = {
      platform: (tenant.phonePlatform as SmsProviderConfig["platform"]) ?? null,
      config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant.mainPhoneNumber ?? null,
    };
    const msg = `Hi ${firstName}! Your payment card${expLabel} with ${businessName} is expiring soon. Please update it here: ${portalUrl}`;
    const result = await sendSms(smsConfig, customer.phone, msg);
    if (result.success) sent.push("sms");
    else logger.warn({ error: result.error, customerId: customer.id }, "Card expiry SMS failed");
  }

  if (sent.length > 0) {
    await db
      .update(customersTable)
      .set({ cardExpiryReminderSentAt: new Date() })
      .where(eq(customersTable.id, customer.id));
    logger.info({ customerId: customer.id, sent }, "Card expiry reminder sent");
  }
}

export function startCardExpiryReminderScheduler() {
  logger.info("Starting card expiry reminder scheduler (runs every 24 hours)");
  void processAllExpiring().catch(err =>
    logger.error({ err }, "Card expiry reminder scheduler error on startup"),
  );
  const interval = setInterval(() => {
    void processAllExpiring().catch(err =>
      logger.error({ err }, "Card expiry reminder scheduler error"),
    );
  }, 24 * 60 * 60 * 1000);
  interval.unref();
}
