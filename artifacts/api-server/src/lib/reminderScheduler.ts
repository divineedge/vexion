/**
 * Reminder Scheduler
 * Scans for jobs scheduled 7 days or 24 hours from now and sends SMS/email reminders.
 * Runs every 15 minutes via setInterval.
 *
 * Idempotency: before sending each reminder we do an atomic conditional UPDATE
 * (WHERE remindersSent->>'sent7d' IS NOT 'true') and only proceed if one row
 * was updated. This prevents duplicate sends in multi-instance deployments.
 */

import { db, jobsTable, customersTable, propertiesTable, tenantsTable, communicationsLogTable } from "@workspace/db";
import { eq, and, or, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, buildReminderEmailBody, buildReminderSmsBody, type EmailProviderConfig } from "./emailProvider";

interface RemindersSent {
  sent7d?: boolean;
  sent24h?: boolean;
  sentAt7d?: string | null;
  sentAt24h?: string | null;
}

/**
 * Atomically claim a reminder slot on a job.
 * Returns true if this process successfully claimed the slot (i.e. it wasn't
 * already sent), false if another instance beat us to it.
 */
async function claimReminderSlot(jobId: number, reminderType: "7d" | "24h"): Promise<boolean> {
  const field = reminderType === "7d" ? "sent7d" : "sent24h";

  // Conditional JSONB update — only succeeds if the flag is not already true.
  // COALESCE handles both NULL and missing key cases.
  const result = await db.execute(sql`
    UPDATE jobs
    SET reminders_sent = jsonb_set(
      COALESCE(reminders_sent, '{}'::jsonb),
      ${sql.raw(`'{${field}}'`)},
      'true'
    )
    WHERE id = ${jobId}
      AND COALESCE((reminders_sent->>${sql.raw(`'${field}'`)})::boolean, false) = false
  `);

  // Drizzle's execute returns a pg result; rowCount > 0 means we got the slot
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

async function processReminders() {
  const now = new Date();

  // Windows for 7-day reminder (scheduled_at is in [now+6d23h, now+7d1h])
  const window7dStart = new Date(now.getTime() + (7 * 24 - 1) * 60 * 60 * 1000);
  const window7dEnd   = new Date(now.getTime() + (7 * 24 + 1) * 60 * 60 * 1000);

  // Windows for 24h reminder (scheduled_at is in [now+23h, now+25h])
  const window24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const window24hEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Fetch only active (scheduled / in_progress) jobs in either window
  const jobs = await db
    .select({
      job: jobsTable,
      customer: customersTable,
      propertyAddress: propertiesTable.address,
      tenant: tenantsTable,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(tenantsTable, eq(jobsTable.tenantId, tenantsTable.id))
    .where(
      and(
        // Only actionable job statuses — never remind for cancelled/on-hold
        inArray(jobsTable.status, ["scheduled", "in_progress"]),
        or(
          sql`${jobsTable.scheduledAt} BETWEEN ${window7dStart.toISOString()}::timestamptz AND ${window7dEnd.toISOString()}::timestamptz`,
          sql`${jobsTable.scheduledAt} BETWEEN ${window24hStart.toISOString()}::timestamptz AND ${window24hEnd.toISOString()}::timestamptz`,
        ),
      ),
    );

  for (const row of jobs) {
    const { job, customer, tenant, propertyAddress } = row;
    if (!customer || !tenant) continue;
    if (customer.smsOptOut && customer.emailOptOut) continue;

    const remindersSent = (job.remindersSent as RemindersSent) ?? {};
    const msSinceNow = job.scheduledAt.getTime() - now.getTime();
    const hoursUntil = msSinceNow / (1000 * 60 * 60);

    const is7dWindow  = hoursUntil >= 7 * 24 - 1 && hoursUntil <= 7 * 24 + 1;
    const is24hWindow = hoursUntil >= 23 && hoursUntil <= 25;

    if (is7dWindow && !remindersSent.sent7d) {
      // Atomically claim the 7d slot before sending
      const claimed = await claimReminderSlot(job.id, "7d");
      if (claimed) {
        await sendReminder({ job, customer, tenant, propertyAddress: propertyAddress ?? null, reminderType: "7d", now });
      }
    }
    if (is24hWindow && !remindersSent.sent24h) {
      const claimed = await claimReminderSlot(job.id, "24h");
      if (claimed) {
        await sendReminder({ job, customer, tenant, propertyAddress: propertyAddress ?? null, reminderType: "24h", now });
      }
    }
  }
}

async function sendReminder(params: {
  job: typeof jobsTable.$inferSelect;
  customer: typeof customersTable.$inferSelect;
  tenant: typeof tenantsTable.$inferSelect;
  propertyAddress: string | null;
  reminderType: "7d" | "24h";
  now: Date;
}) {
  const { job, customer, tenant, propertyAddress, reminderType, now } = params;
  const companyName = tenant.name;

  const smsProviderConfig: SmsProviderConfig = {
    platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | null) ?? null,
    config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
    fromNumber: tenant.mainPhoneNumber ?? null,
  };

  const emailProviderConfig: EmailProviderConfig = {
    provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
    config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
    fromAddress: (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
  };

  const messageType = reminderType === "7d" ? "reminder_7d" : "reminder_24h";
  const results: string[] = [];
  const failures: string[] = [];

  // Send SMS if customer has a phone and hasn't opted out
  if (customer.phone && !customer.smsOptOut) {
    const smsBody = buildReminderSmsBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress,
      companyName,
    });

    const smsResult = await sendSms(smsProviderConfig, customer.phone, smsBody);

    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer.id,
      direction: "outbound",
      channel: "sms",
      fromAddress: tenant.mainPhoneNumber ?? null,
      toAddress: customer.phone,
      body: smsBody,
      status: smsResult.success ? "sent" : "failed",
      externalId: smsResult.externalId ?? null,
      messageType,
      jobId: job.id,
    });

    if (smsResult.success) results.push("sms");
    else {
      failures.push(`sms: ${smsResult.error}`);
      logger.warn({ error: smsResult.error, jobId: job.id }, "SMS reminder failed");
    }
  }

  // Send email if customer has an email and hasn't opted out
  if (customer.email && !customer.emailOptOut) {
    const { subject, body } = buildReminderEmailBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress,
      companyName,
    });

    const emailResult = await sendEmail(emailProviderConfig, customer.email, subject, body);

    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer.id,
      direction: "outbound",
      channel: "email",
      toAddress: customer.email,
      subject,
      body,
      status: emailResult.success ? "sent" : "failed",
      externalId: emailResult.externalId ?? null,
      messageType,
      jobId: job.id,
    });

    if (emailResult.success) results.push("email");
    else {
      failures.push(`email: ${emailResult.error}`);
      logger.warn({ error: emailResult.error, jobId: job.id }, "Email reminder failed");
    }
  }

  // Update the timestamp on the job now that we've attempted the send.
  // The sent flag was already set atomically by claimReminderSlot before we sent.
  const sentAtField = reminderType === "7d" ? "sentAt7d" : "sentAt24h";
  await db.execute(sql`
    UPDATE jobs
    SET reminders_sent = jsonb_set(
      COALESCE(reminders_sent, '{}'::jsonb),
      ${sql.raw(`'{${sentAtField}}'`)},
      ${JSON.stringify(now.toISOString())}::jsonb
    )
    WHERE id = ${job.id}
  `);

  if (results.length > 0) {
    logger.info({ jobId: job.id, reminderType, channels: results }, "Reminders sent");
  }
  if (failures.length > 0) {
    logger.warn({ jobId: job.id, reminderType, failures }, "Some reminder channels failed");
  }
}

/**
 * Dev/Test Panel: preview jobs scheduled within the next 7 days for this tenant
 * that have not yet received their 7-day reminder, without sending anything.
 */
export async function previewWeeklyReminders(tenantId: number) {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const jobs = await db
    .select({ job: jobsTable, customerName: customersTable.name, customerEmail: customersTable.email, customerPhone: customersTable.phone, smsOptOut: customersTable.smsOptOut, emailOptOut: customersTable.emailOptOut })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      inArray(jobsTable.status, ["scheduled", "in_progress"]),
      sql`${jobsTable.scheduledAt} BETWEEN ${now.toISOString()}::timestamptz AND ${weekOut.toISOString()}::timestamptz`,
    ));

  return jobs.map(({ job, customerName, customerEmail, customerPhone, smsOptOut, emailOptOut }) => {
    const remindersSent = (job.remindersSent as RemindersSent) ?? {};
    const wouldSend = !remindersSent.sent7d && !(smsOptOut && emailOptOut) && (!!customerEmail || !!customerPhone);
    return {
      jobId: job.id,
      jobTitle: job.title,
      customerName: customerName ?? "Unknown",
      scheduledAt: job.scheduledAt.toISOString(),
      alreadySent: !!remindersSent.sent7d,
      wouldSend,
    };
  });
}

/** Dev/Test Panel: actually sends this week's 7-day reminders right now for this tenant, respecting the same idempotency claim used by the scheduler. */
export async function runWeeklyRemindersNow(tenantId: number) {
  const preview = await previewWeeklyReminders(tenantId);
  const targets = preview.filter(p => p.wouldSend);
  const results: Array<{ jobId: number; jobTitle: string; sent: boolean }> = [];

  for (const target of targets) {
    const claimed = await claimReminderSlot(target.jobId, "7d");
    if (!claimed) { results.push({ jobId: target.jobId, jobTitle: target.jobTitle, sent: false }); continue; }

    const [row] = await db
      .select({ job: jobsTable, customer: customersTable, propertyAddress: propertiesTable.address, tenant: tenantsTable })
      .from(jobsTable)
      .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .leftJoin(tenantsTable, eq(jobsTable.tenantId, tenantsTable.id))
      .where(and(eq(jobsTable.id, target.jobId), eq(jobsTable.tenantId, tenantId)));

    if (!row?.customer || !row.tenant) { results.push({ jobId: target.jobId, jobTitle: target.jobTitle, sent: false }); continue; }

    await sendReminder({ job: row.job, customer: row.customer, tenant: row.tenant, propertyAddress: row.propertyAddress ?? null, reminderType: "7d", now: new Date() });
    results.push({ jobId: target.jobId, jobTitle: target.jobTitle, sent: true });
  }
  return results;
}

export function startReminderScheduler() {
  logger.info("Starting reminder scheduler (runs every 15 minutes)");

  // Run immediately on startup, then every 15 minutes
  void processReminders().catch(err => logger.error({ err }, "Reminder scheduler error"));

  const interval = setInterval(() => {
    void processReminders().catch(err => logger.error({ err }, "Reminder scheduler error"));
  }, 15 * 60 * 1000);

  // Allow Node.js to exit even if interval is pending
  interval.unref();
}
