import { invoiceBalance } from "./customerCredit";
/**
 * Payment Reminder & Stop-Service Scheduler
 * Runs daily (and once on startup). For each tenant with paymentRemindersEnabled:
 *  - sends the configured reminder(s) (sms/email) for unpaid invoices whose
 *    dueDate has crossed one of the tenant's paymentReminderSchedule offsets,
 *    tracked idempotently in invoices.paymentRemindersSent (array of offsetDays sent).
 *  - if stopServiceRuleEnabled, flags (never auto-pauses) any recurring
 *    customer whose oldest overdue invoice has crossed stopServiceThresholdDays,
 *    creating one stop_service_flags row per invoice (skipped if one already exists).
 */

import { db, tenantsTable, invoicesTable, customersTable, jobsTable, communicationsLogTable, stopServiceFlagsTable } from "@workspace/db";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import {reminderActions} from "./documentReminderActions";
import { logger } from "./logger";
import { sendSms, type SmsProviderConfig } from "./smsProvider";
import { sendEmail, applyTemplate, type EmailProviderConfig } from "./emailProvider";

export interface ReminderRule {
  offsetDays: number;
  label: string;
  /** Per-rule channel selection. Omitted on rules created before this feature — falls back to the tenant's legacy global channel setting. */
  channels?: string[];
  notifyAdmin?: boolean;
  createTask?: boolean;
}

/**
 * Picks the single highest-offset rule that (a) has been crossed (daysFromDue >= offsetDays)
 * and (b) has not yet been recorded as sent. Returns undefined when no rule qualifies.
 * Exported for unit testing.
 */
export function pickDueRule(
  schedule: ReminderRule[],
  daysFromDue: number,
  alreadySent: number[],
): ReminderRule | undefined {
  return schedule
    .filter(r => daysFromDue >= r.offsetDays && !alreadySent.includes(r.offsetDays))
    .sort((a, b) => b.offsetDays - a.offsetDays)[0];
}

/** @internal exported for integration tests only */
export async function processTenant(tenant: typeof tenantsTable.$inferSelect) {
  const now = new Date();
  const schedule = (tenant.paymentReminderSchedule as ReminderRule[]) ?? [];
  // Legacy tenant-wide default, used only for rules that predate per-rule channels.
  const legacyChannels = (tenant.paymentReminderChannels as string[]) ?? ["email"];

  const unpaidInvoices = await db
    .select({ invoice: invoicesTable, customer: customersTable })
    .from(invoicesTable)
    .leftJoin(customersTable, and(
      eq(invoicesTable.customerId, customersTable.id),
      eq(invoicesTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(invoicesTable.tenantId, tenant.id),
      inArray(invoicesTable.status, ["sent","overdue"]),
      isNull(invoicesTable.archivedAt),
      isNull(customersTable.archivedAt),
      sql`${invoicesTable.dueDate} IS NOT NULL`,
    ));

  for (const { invoice, customer } of unpaidInvoices) {
    if (!customer || !invoice.dueDate) continue;
    if (invoiceBalance(invoice)<=0) continue;

    const daysFromDue = Math.floor((now.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const alreadySent = (invoice.paymentRemindersSent as number[] | null) ?? [];

    // Find the highest-offset rule that has been crossed and not yet sent.
    const dueRule = schedule
      .filter(r => daysFromDue >= r.offsetDays && !alreadySent.includes(r.offsetDays))
      .sort((a, b) => b.offsetDays - a.offsetDays)[0];

    if (dueRule) {
      await reminderActions({tenantId:tenant.id,kind:"invoice",id:invoice.id,customerId:customer.id,customerName:customer.name,link:`/invoices?invoiceId=${invoice.id}`},dueRule);
      const channels = dueRule.channels !== undefined ? dueRule.channels : legacyChannels;
      const delivered = await sendPaymentReminder({ tenant, customer, invoice, rule: dueRule, channels });
      // Only record the offset as "sent" once at least one channel actually
      // delivered. A transient provider failure must NOT be marked sent —
      // otherwise this offset would silently never be retried on the next run.
      // The conditional WHERE clause still guards against double-marking if
      // this run somehow raced another (e.g. a manual re-trigger).
      if (delivered) {
        await db.execute(sql`
          UPDATE invoices
          SET payment_reminders_sent = COALESCE(payment_reminders_sent, '[]'::jsonb) || ${JSON.stringify([dueRule.offsetDays])}::jsonb
          WHERE id = ${invoice.id}
            AND NOT (COALESCE(payment_reminders_sent, '[]'::jsonb) @> ${JSON.stringify([dueRule.offsetDays])}::jsonb)
        `);
      } else {
        logger.warn({ invoiceId: invoice.id, offsetDays: dueRule.offsetDays }, "Payment reminder not delivered on any channel; will retry next run");
      }
    }

    // Stop-service flagging (never auto-pauses)
    if (tenant.stopServiceRuleEnabled && daysFromDue >= tenant.stopServiceThresholdDays) {
      const [existingFlag] = await db.select().from(stopServiceFlagsTable).where(and(
        eq(stopServiceFlagsTable.tenantId, tenant.id),
        eq(stopServiceFlagsTable.invoiceId, invoice.id),
      )).limit(1);

      if (!existingFlag) {
        // Only relevant for customers with an active recurring series.
        const [recurringRoot] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(
          eq(jobsTable.tenantId, tenant.id),
          eq(jobsTable.customerId, customer.id),
          isNull(jobsTable.recurrenceParentId),
          sql`${jobsTable.recurrenceRule} IS NOT NULL`,
        )).limit(1);

        if (recurringRoot) {
          await db.insert(stopServiceFlagsTable).values({
            tenantId: tenant.id,
            customerId: customer.id,
            invoiceId: invoice.id,
            daysOverdue: daysFromDue,
            message: `Invoice ${invoice.invoiceNumber} is ${daysFromDue} days overdue (threshold: ${tenant.stopServiceThresholdDays} days). Recurring service has not been paused — office review required.`,
          });
          logger.info({ tenantId: tenant.id, customerId: customer.id, invoiceId: invoice.id, daysFromDue }, "Stop-service flag created for office review");
        }
      }
    }
  }
}

/** @internal exported so the on-demand send-reminder route can reuse it */
export async function sendPaymentReminder(params: {
  tenant: typeof tenantsTable.$inferSelect;
  customer: typeof customersTable.$inferSelect;
  invoice: typeof invoicesTable.$inferSelect;
  rule: ReminderRule;
  channels: string[];
}): Promise<boolean> {
  const { tenant, customer, invoice, rule, channels } = params;
  const companyName = tenant.name;
  const firstName = customer.name.split(" ")[0] ?? customer.name;
  const isOverdue = rule.offsetDays > 0;
  let delivered = false;

  const notifTemplates = (tenant.notificationTemplates as Record<string, string> | null) ?? {};
  const templateVars: Record<string, string> = {
    firstName,
    companyName,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoiceBalance(invoice).toFixed(2),
    dueMessage: isOverdue ? "is now overdue" : "is due soon",
  };

  if (channels.includes("email") && customer.email && !customer.emailOptOut) {
    const defaultSubject = isOverdue
      ? `Payment overdue — Invoice ${invoice.invoiceNumber}`
      : `Payment reminder — Invoice ${invoice.invoiceNumber} due soon`;
    const defaultBody = [
      `Hi ${firstName},`,
      "",
      isOverdue
        ? `Invoice ${invoice.invoiceNumber} balance $${invoiceBalance(invoice).toFixed(2)} is now overdue (${rule.label}).`
        : `This is a reminder that invoice ${invoice.invoiceNumber} balance $${invoiceBalance(invoice).toFixed(2)} is due soon (${rule.label}).`,
      "",
      "Please arrange payment at your earliest convenience.",
      "",
      "Thank you,",
      companyName,
    ].join("\n");
    const subject = notifTemplates.paymentReminderEmailSubject ? applyTemplate(notifTemplates.paymentReminderEmailSubject, templateVars) : defaultSubject;
    const body = notifTemplates.paymentReminderEmailBody ? applyTemplate(notifTemplates.paymentReminderEmailBody, templateVars) : defaultBody;

    const emailProviderConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    const result = await sendEmail(emailProviderConfig, customer.email, subject, body);
    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id, customerId: customer.id, direction: "outbound", channel: "email",
      toAddress: customer.email, subject, body,
      status: result.success ? "sent" : "failed", externalId: result.externalId ?? null,
      messageType: "payment_reminder", jobId: invoice.jobId ?? null,
    });
    if (result.success) delivered = true;
    else logger.warn({ error: result.error, invoiceId: invoice.id }, "Payment reminder email failed");
  }

  if (channels.includes("sms") && customer.phone && !customer.smsOptOut) {
    const defaultSms = isOverdue
      ? `Hi ${firstName}, invoice ${invoice.invoiceNumber} balance ($${invoiceBalance(invoice).toFixed(2)}) from ${companyName} is overdue. Please arrange payment. Reply STOP to opt out.`
      : `Hi ${firstName}, reminder: invoice ${invoice.invoiceNumber} balance ($${invoiceBalance(invoice).toFixed(2)}) from ${companyName} is due soon. Reply STOP to opt out.`;
    const smsBody = notifTemplates.paymentReminderSms ? applyTemplate(notifTemplates.paymentReminderSms, templateVars) : defaultSms;

    const smsProviderConfig: SmsProviderConfig = {
      platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
      config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant.mainPhoneNumber ?? null,
    };
    const result = await sendSms(smsProviderConfig, customer.phone, smsBody);
    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id, customerId: customer.id, direction: "outbound", channel: "sms",
      fromAddress: tenant.mainPhoneNumber ?? null, toAddress: customer.phone, body: smsBody,
      status: result.success ? "sent" : "failed", externalId: result.externalId ?? null,
      messageType: "payment_reminder", jobId: invoice.jobId ?? null,
    });
    if (result.success) delivered = true;
    else logger.warn({ error: result.error, invoiceId: invoice.id }, "Payment reminder SMS failed");
  }

  return delivered;
}

async function processAllTenants() {
  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.paymentRemindersEnabled, true));
  for (const tenant of tenants) {
    try {
      await processTenant(tenant);
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Payment reminder scheduler error for tenant");
    }
  }
}

export function startPaymentReminderScheduler() {
  logger.info("Starting payment reminder scheduler (runs once on startup, then every 24 hours)");

  void processAllTenants().catch(err => logger.error({ err }, "Payment reminder scheduler error"));

  const interval = setInterval(() => {
    void processAllTenants().catch(err => logger.error({ err }, "Payment reminder scheduler error"));
  }, 24 * 60 * 60 * 1000);

  interval.unref();
}
