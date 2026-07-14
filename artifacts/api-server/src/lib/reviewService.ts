/**
 * Review Request Service
 * Sends a review-request message (email/SMS) linking to the public,
 * no-login review page and logs a row in review_requests + communications_log.
 */

import crypto from "crypto";
import { db, reviewRequestsTable, communicationsLogTable, tenantsTable, customersTable } from "@workspace/db";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, type EmailProviderConfig } from "./emailProvider";

export function generateReviewToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Builds the absolute, publicly reachable URL for a review token.
 * Prefers REPLIT_DOMAINS (set for both dev and deployed/production apps),
 * falling back to REPLIT_DEV_DOMAIN. Returns null (never a relative path)
 * if no public domain can be determined, so callers can fail safely
 * instead of sending an unusable link in an email/SMS.
 */
export function buildPublicReviewUrl(token: string): string | null {
  const domainsEnv = process.env.REPLIT_DOMAINS;
  const firstDomain = domainsEnv?.split(",")[0]?.trim();
  const domain = firstDomain || process.env.REPLIT_DEV_DOMAIN;
  if (!domain) return null;
  return `https://${domain}/review/${token}`;
}

/**
 * Sends a review request to a customer and records it. Returns the created
 * review_requests row, or null if the customer has no usable contact channel.
 */
export async function sendReviewRequest(params: {
  tenant: typeof tenantsTable.$inferSelect;
  customer: typeof customersTable.$inferSelect;
  jobId?: number | null;
  invoiceId?: number | null;
  estimateId?: number | null;
}): Promise<typeof reviewRequestsTable.$inferSelect | null> {
  const { tenant, customer, jobId, invoiceId, estimateId } = params;
  if ((customer.emailOptOut && customer.smsOptOut) || (!customer.email && !customer.phone)) {
    return null;
  }

  const token = generateReviewToken();
  const url = buildPublicReviewUrl(token);
  if (!url) {
    logger.error({ tenantId: tenant.id, customerId: customer.id }, "Cannot send review request: no public domain configured (REPLIT_DOMAINS/REPLIT_DEV_DOMAIN unset)");
    return null;
  }
  const companyName = tenant.name;
  const firstName = customer.name.split(" ")[0] ?? customer.name;

  let channel: "sms" | "email" | "both" = "email";
  const sentChannels: string[] = [];

  if (customer.email && !customer.emailOptOut) {
    const subject = `How did we do, ${firstName}?`;
    const body = [
      `Hi ${firstName},`,
      "",
      `Thank you for choosing ${companyName}! We'd love to hear about your experience.`,
      "",
      `Please take a moment to rate us: ${url}`,
      "",
      `Thank you,`,
      companyName,
    ].join("\n");

    const emailProviderConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    const result = await sendEmail(emailProviderConfig, customer.email, subject, body);
    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer.id,
      direction: "outbound",
      channel: "email",
      toAddress: customer.email,
      subject,
      body,
      status: result.success ? "sent" : "failed",
      externalId: result.externalId ?? null,
      messageType: "review_request",
      jobId: jobId ?? null,
    });
    if (result.success) sentChannels.push("email");
    else logger.warn({ error: result.error, customerId: customer.id }, "Review request email failed");
  }

  if (customer.phone && !customer.smsOptOut) {
    const smsBody = `Hi ${firstName}, thanks for choosing ${companyName}! Please rate your experience: ${url}`;
    const smsProviderConfig: SmsProviderConfig = {
      platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
      config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant.mainPhoneNumber ?? null,
    };
    const result = await sendSms(smsProviderConfig, customer.phone, smsBody);
    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer.id,
      direction: "outbound",
      channel: "sms",
      fromAddress: tenant.mainPhoneNumber ?? null,
      toAddress: customer.phone,
      body: smsBody,
      status: result.success ? "sent" : "failed",
      externalId: result.externalId ?? null,
      messageType: "review_request",
      jobId: jobId ?? null,
    });
    if (result.success) sentChannels.push("sms");
    else logger.warn({ error: result.error, customerId: customer.id }, "Review request SMS failed");
  }

  if (sentChannels.length === 0) return null;
  channel = sentChannels.length === 2 ? "both" : (sentChannels[0] as "sms" | "email");

  const [row] = await db.insert(reviewRequestsTable).values({
    tenantId: tenant.id,
    customerId: customer.id,
    jobId: jobId ?? null,
    invoiceId: invoiceId ?? null,
    estimateId: estimateId ?? null,
    channel,
    token,
    reviewStatus: "new",
  }).returning();

  return row;
}
