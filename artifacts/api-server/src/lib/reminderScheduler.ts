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
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendCustomerVisitPush } from "./customerPush";
import { sendEmail, buildReminderEmailBody, buildReminderSmsBody, applyTemplate, type EmailProviderConfig } from "./emailProvider";

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
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(tenantsTable, eq(jobsTable.tenantId, tenantsTable.id))
    .where(
      and(
        // Only actionable job statuses — never remind for cancelled/on-hold
        inArray(jobsTable.status, ["scheduled", "in_progress"]),
        isNull(jobsTable.archivedAt),
        isNull(customersTable.archivedAt),
        or(
          sql`${jobsTable.scheduledAt} BETWEEN ${window7dStart.toISOString()}::timestamptz AND ${window7dEnd.toISOString()}::timestamptz`,
          sql`${jobsTable.scheduledAt} BETWEEN ${window24hStart.toISOString()}::timestamptz AND ${window24hEnd.toISOString()}::timestamptz`,
        ),
      ),
    );

  for (const row of jobs) {
    const { job, customer, tenant, propertyAddress } = row;
    if (!customer || !tenant) continue;
    if (customer.smsOptOut && customer.emailOptOut && !job.pushReminderEnabled) continue;

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
  const firstName = customer.name.split(" ")[0] ?? customer.name;
  const notifTemplates = (tenant.notificationTemplates as Record<string, string> | null) ?? {};
  // Pre-compute date strings for template variable interpolation
  const templateVars: Record<string, string> = {
    firstName,
    companyName,
    jobTitle: job.title,
    date: job.scheduledAt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    time: job.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
    address: propertyAddress ?? "",
  };

  const smsProviderConfig: SmsProviderConfig = {
    platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
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

  // Send SMS if customer has a phone, hasn't opted out globally, and this job has SMS reminders enabled
  if (customer.phone && !customer.smsOptOut && job.smsReminderEnabled) {
    const smsBody = notifTemplates.serviceReminderSms
      ? applyTemplate(notifTemplates.serviceReminderSms, templateVars)
      : buildReminderSmsBody({ customerName: firstName, jobTitle: job.title, scheduledAt: job.scheduledAt, propertyAddress, companyName });

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
      errorNote: smsResult.success ? null : (smsResult.error ?? "Unknown SMS error"),
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
  if (customer.email && !customer.emailOptOut && job.emailReminderEnabled) {
    const defaultEmail = buildReminderEmailBody({ customerName: firstName, jobTitle: job.title, scheduledAt: job.scheduledAt, propertyAddress, companyName });
    const subject = notifTemplates.serviceReminderEmailSubject ? applyTemplate(notifTemplates.serviceReminderEmailSubject, templateVars) : defaultEmail.subject;
    const body = notifTemplates.serviceReminderEmailBody ? applyTemplate(notifTemplates.serviceReminderEmailBody, templateVars) : defaultEmail.body;
    // Use branded HTML unless a custom plain-text template is set
    const html = notifTemplates.serviceReminderEmailBody ? undefined : defaultEmail.html;

    const emailResult = await sendEmail(emailProviderConfig, customer.email, subject, body, html);

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
      errorNote: emailResult.success ? null : (emailResult.error ?? "Unknown email error"),
      messageType,
      jobId: job.id,
    });

    if (emailResult.success) results.push("email");
    else {
      failures.push(`email: ${emailResult.error}`);
      logger.warn({ error: emailResult.error, jobId: job.id }, "Email reminder failed");
    }
  }

  if(job.pushReminderEnabled){
    try{
      const pushed=await sendCustomerVisitPush(tenant.id,customer.id,`${tenant.name}: upcoming service`,`${job.title} is scheduled for ${new Intl.DateTimeFormat("en-US",{timeZone:tenant.timezone,dateStyle:"medium"}).format(job.scheduledAt)}. Please prepare your property for the visit.`);
      if(pushed.sent)results.push("push");
      if(pushed.failed)failures.push("push: a device could not receive this reminder");
    }catch{failures.push("push: delivery unavailable");}
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
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      inArray(jobsTable.status, ["scheduled", "in_progress"]),
      isNull(jobsTable.archivedAt),
      isNull(customersTable.archivedAt),
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
      .leftJoin(customersTable, and(
        eq(jobsTable.customerId, customersTable.id),
        eq(jobsTable.tenantId, customersTable.tenantId),
      ))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .leftJoin(tenantsTable, eq(jobsTable.tenantId, tenantsTable.id))
      .where(and(
        eq(jobsTable.id, target.jobId),
        eq(jobsTable.tenantId, tenantId),
        isNull(jobsTable.archivedAt),
        isNull(customersTable.archivedAt),
      ));

    if (!row?.customer || !row.tenant) { results.push({ jobId: target.jobId, jobTitle: target.jobTitle, sent: false }); continue; }

    await sendReminder({ job: row.job, customer: row.customer, tenant: row.tenant, propertyAddress: row.propertyAddress ?? null, reminderType: "7d", now: new Date() });
    results.push({ jobId: target.jobId, jobTitle: target.jobTitle, sent: true });
  }
  return results;
}

/**
 * Manually re-send a reminder for a specific job, resetting the slot so it
 * can be claimed again.  Used by the "Re-send reminder" button in the UI.
 *
 * Steps:
 *  1. Clear the sent flag so the slot is open again.
 *  2. Claim the slot atomically (prevents duplicate sends if called twice).
 *  3. Send the reminder immediately.
 */
export async function resendReminderForJob(
  tenantId: number,
  jobId: number,
  reminderType: "7d" | "24h",
): Promise<{ sent: boolean; channels: string[]; failures: string[] }> {
  const field = reminderType === "7d" ? "sent7d" : "sent24h";

  // Step 1: Clear the flag so claimReminderSlot can succeed.
  await db.execute(sql`
    UPDATE jobs
    SET reminders_sent = jsonb_set(
      COALESCE(reminders_sent, '{}'::jsonb),
      ${sql.raw(`'{${field}}'`)},
      'false'
    )
    WHERE id = ${jobId} AND tenant_id = ${tenantId} AND archived_at IS NULL
  `);

  // Step 2: Atomically claim the slot.
  const claimed = await claimReminderSlot(jobId, reminderType);
  if (!claimed) {
    return { sent: false, channels: [], failures: ["slot already claimed by concurrent request"] };
  }

  // Step 3: Fetch job data and send.
  const [row] = await db
    .select({
      job: jobsTable,
      customer: customersTable,
      propertyAddress: propertiesTable.address,
      tenant: tenantsTable,
    })
    .from(jobsTable)
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(tenantsTable, eq(jobsTable.tenantId, tenantsTable.id))
    .where(and(
      eq(jobsTable.id, jobId),
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
      isNull(customersTable.archivedAt),
    ));

  if (!row?.customer || !row.tenant) {
    return { sent: false, channels: [], failures: ["job, customer, or tenant not found"] };
  }

  // Capture channel results by temporarily tracking them here.
  // sendReminder logs to DB and returns nothing, so we re-implement a
  // lightweight version that also returns channel outcome.
  const now = new Date();
  const companyName = row.tenant.name;
  const { job, customer, tenant, propertyAddress } = row;

  const smsProviderConfig: SmsProviderConfig = {
    platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
    config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
    fromNumber: tenant.mainPhoneNumber ?? null,
  };
  const emailProviderConfig: EmailProviderConfig = {
    provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
    config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
    fromAddress: (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
  };

  const messageType = reminderType === "7d" ? "reminder_7d" : "reminder_24h";
  const channels: string[] = [];
  const failures: string[] = [];

  if (customer.phone && !customer.smsOptOut && job.smsReminderEnabled) {
    const smsBody = buildReminderSmsBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress: propertyAddress ?? null,
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
      errorNote: smsResult.success ? null : (smsResult.error ?? "Unknown SMS error"),
      messageType,
      jobId: job.id,
    });
    if (smsResult.success) channels.push("sms");
    else failures.push(`sms: ${smsResult.error}`);
  }

  if (customer.email && !customer.emailOptOut) {
    const defaultEmail = buildReminderEmailBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress: propertyAddress ?? null,
      companyName,
    });
    const emailResult = await sendEmail(emailProviderConfig, customer.email, defaultEmail.subject, defaultEmail.body, defaultEmail.html);
    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer.id,
      direction: "outbound",
      channel: "email",
      toAddress: customer.email,
      subject: defaultEmail.subject,
      body: defaultEmail.body,
      status: emailResult.success ? "sent" : "failed",
      externalId: emailResult.externalId ?? null,
      errorNote: emailResult.success ? null : (emailResult.error ?? "Unknown email error"),
      messageType,
      jobId: job.id,
    });
    if (emailResult.success) channels.push("email");
    else failures.push(`email: ${emailResult.error}`);
  }

  // Update the sentAt timestamp.
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

  logger.info({ jobId, reminderType, channels, failures }, "Manual reminder resend completed");
  return { sent: true, channels, failures };
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
