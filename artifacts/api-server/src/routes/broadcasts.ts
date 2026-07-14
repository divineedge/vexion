import { Router, type IRouter } from "express";
import {
  db, customersTable, campaignCustomersTable, jobsTable, tenantsTable,
  broadcastsTable, broadcastRecipientsTable, communicationsLogTable,
} from "@workspace/db";
import { eq, and, or, ilike, inArray, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export interface BroadcastFilter {
  tag?: string;
  city?: string;
  state?: string;
  customerType?: string;
  lastServiceBefore?: string;
  lastServiceAfter?: string;
  campaignId?: number;
  allCustomers?: boolean;
}

/** Resolves a segment filter into the matching customer rows for this tenant, excluding customers who have opted out of the requested channel. */
async function resolveRecipients(tenantId: number, channel: "sms" | "email", filter: BroadcastFilter) {
  const conditions = [eq(customersTable.tenantId, tenantId)];

  if (!filter.allCustomers) {
    if (filter.tag) conditions.push(sql`${filter.tag} = ANY(${customersTable.tags})`);
    if (filter.city) conditions.push(ilike(customersTable.billingCity, `%${filter.city}%`));
    if (filter.state) conditions.push(eq(customersTable.billingState, filter.state));
    if (filter.customerType) conditions.push(eq(customersTable.customerType, filter.customerType));

    if (filter.campaignId) {
      const memberIds = await db
        .select({ customerId: campaignCustomersTable.customerId })
        .from(campaignCustomersTable)
        .where(and(eq(campaignCustomersTable.tenantId, tenantId), eq(campaignCustomersTable.campaignId, filter.campaignId)));
      const ids = memberIds.map(m => m.customerId);
      conditions.push(ids.length > 0 ? inArray(customersTable.id, ids) : sql`false`);
    }

    if (filter.lastServiceBefore || filter.lastServiceAfter) {
      const jobConditions = [eq(jobsTable.tenantId, tenantId), eq(jobsTable.status, "completed")];
      if (filter.lastServiceBefore) jobConditions.push(sql`${jobsTable.completedAt} <= ${filter.lastServiceBefore}::timestamptz`);
      if (filter.lastServiceAfter) jobConditions.push(sql`${jobsTable.completedAt} >= ${filter.lastServiceAfter}::timestamptz`);
      const matchingCustomerIds = await db
        .selectDistinct({ customerId: jobsTable.customerId })
        .from(jobsTable)
        .where(and(...jobConditions));
      const ids = matchingCustomerIds.map(m => m.customerId).filter((id): id is number => id != null);
      conditions.push(ids.length > 0 ? inArray(customersTable.id, ids) : sql`false`);
    }
  }

  // Always exclude opted-out customers and those missing the relevant contact method.
  if (channel === "sms") {
    conditions.push(eq(customersTable.smsOptOut, false));
    conditions.push(sql`${customersTable.phone} IS NOT NULL AND ${customersTable.phone} != ''`);
  } else {
    conditions.push(eq(customersTable.emailOptOut, false));
    conditions.push(sql`${customersTable.email} IS NOT NULL AND ${customersTable.email} != ''`);
  }

  return db.select().from(customersTable).where(and(...conditions));
}

function formatBroadcast(b: typeof broadcastsTable.$inferSelect) {
  return {
    ...b,
    sentAt: b.sentAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

router.post("/broadcasts/preview", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { channel, filter } = req.body as { channel: "sms" | "email"; filter: BroadcastFilter };
  if (channel !== "sms" && channel !== "email") { res.status(400).json({ error: "channel must be 'sms' or 'email'" }); return; }

  const recipients = await resolveRecipients(tenantId, channel, filter ?? {});
  res.json({
    count: recipients.length,
    sample: recipients.slice(0, 10).map(c => ({ id: c.id, name: c.name, contact: channel === "sms" ? c.phone : c.email })),
  });
});

router.post("/broadcasts/send", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { channel, subject, body, filter } = req.body as { channel: "sms" | "email"; subject?: string; body: string; filter: BroadcastFilter };
  if (channel !== "sms" && channel !== "email") { res.status(400).json({ error: "channel must be 'sms' or 'email'" }); return; }
  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }
  if (channel === "email" && !subject?.trim()) { res.status(400).json({ error: "subject is required for email broadcasts" }); return; }

  const recipients = await resolveRecipients(tenantId, channel, filter ?? {});

  const [broadcast] = await db.insert(broadcastsTable).values({
    tenantId, channel, subject: subject ?? null, body,
    recipientFilter: filter ?? {}, recipientCount: recipients.length,
    status: "sending", createdBy: userId,
  }).returning();

  // Fire the send in the background so the request returns immediately with the count;
  // the broadcast row is updated to 'completed'/'failed' once every recipient is processed.
  void dispatchBroadcast(tenantId, broadcast.id, channel, subject ?? null, body, recipients)
    .catch(err => logger.error({ err, broadcastId: broadcast.id }, "Broadcast dispatch crashed"));

  res.status(201).json(formatBroadcast(broadcast));
});

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
      logger.warn({ err, customerId: customer.id, broadcastId }, "Broadcast recipient send failed");
      await db.insert(broadcastRecipientsTable).values({ tenantId, broadcastId, customerId: customer.id, status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  await db.update(broadcastsTable)
    .set({ status: failed > 0 && sent === 0 ? "failed" : "completed", sentAt: new Date(), stats: { sent, failed, optedOut: 0 } })
    .where(eq(broadcastsTable.id, broadcastId));
}

router.get("/broadcasts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const rows = await db.select().from(broadcastsTable).where(eq(broadcastsTable.tenantId, tenantId)).orderBy(desc(broadcastsTable.createdAt));
  res.json(rows.map(formatBroadcast));
});

router.get("/broadcasts/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(broadcastsTable).where(and(eq(broadcastsTable.id, id), eq(broadcastsTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const recipients = await db
    .select({ recipient: broadcastRecipientsTable, customerName: customersTable.name })
    .from(broadcastRecipientsTable)
    .leftJoin(customersTable, eq(broadcastRecipientsTable.customerId, customersTable.id))
    .where(eq(broadcastRecipientsTable.broadcastId, id))
    .orderBy(desc(broadcastRecipientsTable.createdAt));

  res.json({
    ...formatBroadcast(row),
    recipients: recipients.map(r => ({ ...r.recipient, customerName: r.customerName ?? "Unknown", createdAt: r.recipient.createdAt.toISOString() })),
  });
});

export default router;
