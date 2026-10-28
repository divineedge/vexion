import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db, communicationsLogTable, customersTable, tenantsTable, jobsTable, propertiesTable, followupQueueItemsTable, internalTasksTable, taskNotificationsTable, usersTable } from "@workspace/db";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import { ADMIN_ROLES } from "../lib/roles";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { hasSoftwareFeature } from "../lib/softwareFeatures";
import { sendSms, type SmsProviderConfig } from "../lib/smsProvider";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { listQuoCalls, getQuoCallById, verifyQuoSignature } from "../lib/quoClient";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /communications/customers/:customerId — conversation thread for a customer
// ---------------------------------------------------------------------------
router.get("/communications/customers/:customerId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const customerId = parseInt(req.params.customerId, 10);

  const rows = await db
    .select()
    .from(communicationsLogTable)
    .where(
      and(
        eq(communicationsLogTable.tenantId, tenantId),
        eq(communicationsLogTable.customerId, customerId),
      ),
    )
    .orderBy(desc(communicationsLogTable.createdAt));

  res.json(rows.map(r => ({
    id: r.id,
    direction: r.direction,
    channel: r.channel,
    fromAddress: r.fromAddress ?? null,
    toAddress: r.toAddress ?? null,
    subject: r.subject ?? null,
    body: r.body,
    status: r.status,
    externalId: r.externalId ?? null,
    messageType: r.messageType,
    jobId: r.jobId ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ---------------------------------------------------------------------------
// POST /communications/send — manually send a message to a customer
// ---------------------------------------------------------------------------
router.post("/communications/send", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, channel, body, subject, jobId } = req.body as {
    customerId?: number;
    channel?: string;
    body?: string;
    subject?: string;
    jobId?: number;
  };

  if (!customerId || !channel || !body) {
    res.status(400).json({ error: "customerId, channel, and body are required" });
    return;
  }
  if (!["sms", "email"].includes(channel)) {
    res.status(400).json({ error: "channel must be 'sms' or 'email'" });
    return;
  }

  const [[customer], [tenant]] = await Promise.all([
    db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId))).limit(1),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
  ]);

  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (customer.archivedAt) {
    res.status(409).json({ error: "Archived customers cannot receive messages" });
    return;
  }

  if (channel === "sms" && customer.smsOptOut) {
    res.status(422).json({ error: "Customer has opted out of SMS" });
    return;
  }
  if(channel==="sms" && !await hasSoftwareFeature(tenantId,"phone_integration")){
    res.status(403).json({error:"Business phone/SMS integration is not included in this software plan."});return;
  }
  if (channel === "email" && customer.emailOptOut) {
    res.status(422).json({ error: "Customer has opted out of email" });
    return;
  }

  let result;
  let toAddress: string;

  if (channel === "sms") {
    toAddress = customer.phone;
    const smsConfig: SmsProviderConfig = {
      platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
      config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant.mainPhoneNumber ?? null,
    };
    result = await sendSms(smsConfig, toAddress, body,{tenantId});
  } else {
    toAddress = customer.email;
    const emailConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    result = await sendEmail(emailConfig, toAddress, subject ?? "(no subject)", body);
  }

  const [log] = await db.insert(communicationsLogTable).values({
    tenantId,
    customerId,
    direction: "outbound",
    channel,
    fromAddress: channel === "sms" ? (tenant.mainPhoneNumber ?? null) : ((tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null),
    toAddress,
    subject: subject ?? null,
    body,
    status: result.success ? "sent" : "failed",
    externalId: result.externalId ?? null,
    messageType: "manual",
    jobId: jobId ?? null,
  }).returning();

  res.status(result.success ? 201 : 500).json({
    id: log.id,
    direction: log.direction,
    channel: log.channel,
    toAddress: log.toAddress,
    body: log.body,
    status: log.status,
    createdAt: log.createdAt.toISOString(),
    error: result.success ? undefined : result.error,
  });
});

// ---------------------------------------------------------------------------
// Webhook signature verification helpers
// ---------------------------------------------------------------------------

/**
 * Verify a Twilio request signature.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  try {
    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map(k => `${k}${params[k]}`).join("");
    const expected = createHmac("sha1", authToken).update(`${url}${paramStr}`).digest("base64");
    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Verify an OpenPhone webhook signature.
 * OpenPhone sends X-OpenPhone-Signature: sha256=<hex>
 */
function verifyOpenPhoneSignature(secret: string, signature: string, rawBody: string): boolean {
  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedFull = `sha256=${expected}`;
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expectedFull, "utf8");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /communications/webhook — inbound message webhook (OpenPhone / Twilio / Grasshopper)
// ---------------------------------------------------------------------------
router.post("/communications/webhook", async (req, res): Promise<void> => {
  // OpenPhone, Twilio, and Grasshopper all send webhooks with slightly different shapes.
  // We verify the signature before processing to prevent spoofed opt-out requests.
  const payload = req.body as Record<string, unknown>;

  // Detect provider from headers and verify signature before trusting the payload.
  // Without verification, anyone could spoof opt-out/opt-in requests.
  const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
  const openPhoneSig = req.headers["x-openphone-signature"] as string | undefined;
  const quoWebhookId = req.headers["webhook-id"] as string | undefined;
  const quoWebhookTimestamp = req.headers["webhook-timestamp"] as string | undefined;
  const quoWebhookSig = req.headers["webhook-signature"] as string | undefined;

  if (quoWebhookId && quoWebhookTimestamp && quoWebhookSig) {
    // Quo webhook (svix-compatible scheme) — verify HMAC-SHA256 against the
    // tenant's whsec_... signing key using the raw request bytes.
    const rawBody = ((req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0)).toString("utf8");
    const toNumber = (payload["to"] ?? "") as string;
    const matchingTenants = toNumber
      ? await db.select().from(tenantsTable).where(
          or(
            eq(tenantsTable.mainPhoneNumber, toNumber),
            eq(tenantsTable.marketingPhoneNumber, toNumber),
          ),
        )
      : await db.select().from(tenantsTable).where(eq(tenantsTable.phonePlatform, "quo"));

    const verified = matchingTenants.some(t => {
      const cfg = (t.phonePlatformConfig as Record<string, string>) ?? {};
      const whsecKey = cfg["webhookSecret"] ?? "";
      if (!whsecKey) return false;
      return verifyQuoSignature(whsecKey, quoWebhookId, quoWebhookTimestamp, quoWebhookSig, rawBody);
    });

    if (!verified) {
      res.status(403).json({ error: "Invalid Quo webhook signature" });
      return;
    }
  } else if (twilioSig) {
    // Twilio webhook — verify HMAC-SHA1 against the auth token.
    // We need to find the tenant's auth token to verify. Look up by 'To' number first.
    const toNumber = (payload["To"] ?? payload["to"] ?? "") as string;
    const matchingTenants = toNumber
      ? await db.select().from(tenantsTable).where(
          or(
            eq(tenantsTable.mainPhoneNumber, toNumber),
            eq(tenantsTable.marketingPhoneNumber, toNumber),
          ),
        )
      : [];

    const fullUrl = `${req.protocol}://${req.hostname}${req.originalUrl}`;
    const verified = matchingTenants.some(t => {
      const cfg = (t.phonePlatformConfig as Record<string, string>) ?? {};
      const authToken = cfg["authToken"] ?? "";
      if (!authToken) return false;
      return verifyTwilioSignature(authToken, twilioSig, fullUrl, req.body as Record<string, string>);
    });

    if (!verified) {
      res.status(403).json({ error: "Invalid Twilio signature" });
      return;
    }
  } else if (openPhoneSig) {
    // OpenPhone webhook — verify HMAC-SHA256 against the webhook secret.
    // Use the raw request bytes to avoid normalization differences after JSON parse.
    const rawBody = ((req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0)).toString("utf8");

    // For SMS events the "to" number is top-level. For call events (call.completed,
    // call.recording.completed) it is nested under data.object.to[0].phoneNumber or
    // data.object.call.to[0].phoneNumber. Try all three locations so call webhooks
    // are not rejected during signature verification before parsing even starts.
    const opObject = (payload["data"] as Record<string, unknown> | undefined)?.["object"] as Record<string, unknown> | undefined;
    const opCallObj = (opObject?.["call"] as Record<string, unknown> | undefined);
    const opToArr = (opObject?.["to"] ?? opCallObj?.["to"] ?? []) as Array<Record<string, string>>;
    const toNumber = ((payload["to"] ?? "") as string)
      || (opToArr[0]?.["phoneNumber"] ?? "");

    const matchingTenants = toNumber
      ? await db.select().from(tenantsTable).where(
          or(
            eq(tenantsTable.mainPhoneNumber, toNumber),
            eq(tenantsTable.marketingPhoneNumber, toNumber),
          ),
        )
      // No "to" found in any known location — fall back to all OpenPhone tenants
      // (same strategy Quo uses) so we can still verify the signature.
      : await db.select().from(tenantsTable).where(eq(tenantsTable.phonePlatform, "openphone"));

    const verified = matchingTenants.some(t => {
      const cfg = (t.phonePlatformConfig as Record<string, string>) ?? {};
      const secret = cfg["webhookSecret"] ?? "";
      if (!secret) return false;
      return verifyOpenPhoneSignature(secret, openPhoneSig, rawBody);
    });

    if (!verified) {
      res.status(403).json({ error: "Invalid OpenPhone signature" });
      return;
    }
  } else {
    // No recognised signature header — reject unauthenticated payloads.
    // This prevents spoofed opt-out mutations from unknown callers.
    res.status(403).json({ error: "Missing webhook signature header" });
    return;
  }

  // Extract common fields across providers
  const from = (payload["from"] ?? payload["From"] ?? "") as string;
  const to = (payload["to"] ?? payload["To"] ?? "") as string;
  const body = (payload["body"] ?? payload["Body"] ?? payload["content"] ?? "") as string;

  // ---- Call events (missed call / voicemail) ---------------------------
  // Twilio voice status callbacks use CallStatus ('no-answer' | 'busy' | 'failed')
  // and optionally RecordingUrl when a voicemail was left.
  //
  // OpenPhone / Quo sends two relevant event types:
  //   - call.completed  → data.object.{ status, from, to:[{phoneNumber}] }
  //                       status === "missed" means a missed call
  //   - call.recording.completed → data.object.{ url, call:{ from, to:[{phoneNumber}] } }
  //                       any recording on a completed call is treated as a voicemail
  //
  // IMPORTANT: OpenPhone does NOT have a separate "call.missed" event type.
  // Missed calls arrive as call.completed with status:"missed".
  // For call events, from/to are nested under data.object (not top-level).
  const twilioCallStatus = (payload["CallStatus"] ?? "") as string;
  const twilioRecordingUrl = (payload["RecordingUrl"] ?? "") as string;
  const openPhoneEventType = (payload["type"] ?? "") as string;
  const openPhoneObject = (payload["data"] as Record<string, unknown> | undefined)?.["object"] as Record<string, unknown> | undefined;
  const openPhoneCallStatus = (openPhoneObject?.["status"] ?? "") as string;
  // call.recording.completed nests the call details one level deeper
  const openPhoneRecordingCallObject = (openPhoneObject?.["call"] as Record<string, unknown> | undefined);

  const isMissedCall = ["no-answer", "busy", "failed"].includes(twilioCallStatus)
    || (openPhoneEventType === "call.completed" && openPhoneCallStatus === "missed");
  // Any recording on a completed call is treated as a voicemail drop
  const isVoicemail = !!twilioRecordingUrl
    || openPhoneEventType === "call.recording.completed";

  if (isMissedCall || isVoicemail) {
    // For OpenPhone/Quo call events, from/to are nested under data.object (or
    // data.object.call for recording events), NOT at the top level of the payload.
    // Fall back to Twilio-style top-level From/To last.
    const openPhoneFrom = (openPhoneObject?.["from"] ?? openPhoneRecordingCallObject?.["from"] ?? "") as string;
    const openPhoneToArr = (openPhoneObject?.["to"] ?? openPhoneRecordingCallObject?.["to"] ?? []) as Array<Record<string, string>>;
    const openPhoneTo = openPhoneToArr[0]?.["phoneNumber"] ?? "";

    const callFrom = openPhoneFrom || from || ((payload["From"] ?? "") as string);
    const callTo = openPhoneTo || to || ((payload["To"] ?? "") as string);

    const tenants = await db
      .select()
      .from(tenantsTable)
      .where(or(eq(tenantsTable.mainPhoneNumber, callTo), eq(tenantsTable.marketingPhoneNumber, callTo)));

    for (const tenant of tenants) {
      const cfg = (tenant.followupTriggerConfig as { missedCall?: { enabled?: boolean } } | null) ?? {};
      if (cfg.missedCall?.enabled === false) continue;

      const [customer] = callFrom
        ? await db
            .select()
            .from(customersTable)
            .where(
              and(
                eq(customersTable.tenantId, tenant.id),
                or(eq(customersTable.phone, callFrom), eq(customersTable.secondaryPhone ?? "", callFrom)),
              ),
            )
            .limit(1)
        : [];

      const triggerType = isVoicemail ? "voicemail" : "missed_call";
      const [log] = await db.insert(communicationsLogTable).values({
        tenantId: tenant.id,
        customerId: customer?.id ?? null,
        direction: "inbound",
        channel: "call",
        fromAddress: callFrom || null,
        toAddress: callTo || null,
        body: isVoicemail ? "Voicemail received" : "Missed call",
        status: isVoicemail ? "voicemail" : "missed",
        messageType: "manual",
      }).returning();

      if (customer) {
        await db.insert(followupQueueItemsTable).values({
          tenantId: tenant.id,
          customerId: customer.id,
          triggerType,
          triggerContextId: log.id,
          reason: isVoicemail
            ? `${customer.name} left a voicemail`
            : `Missed call from ${customer.name}`,
          status: "open",
        });
      }

      // Push an in-app notification to all active admin/office users for this tenant
      const notifMessage = isVoicemail
        ? customer
          ? `${customer.name} left a voicemail`
          : `Voicemail from ${callFrom || "unknown number"}`
        : customer
          ? `Missed call from ${customer.name}`
          : `Missed call from ${callFrom || "unknown number"}`;

      const linkPath = customer
        ? `/communications?customerId=${customer.id}`
        : `/follow-up-queue`;

      const adminUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.tenantId, tenant.id),
            eq(usersTable.isActive, true),
            inArray(usersTable.role, Array.from(ADMIN_ROLES)),
          ),
        );

      if (adminUsers.length > 0) {
        await db.insert(taskNotificationsTable).values(
          adminUsers.map(u => ({
            tenantId: tenant.id,
            recipientUserId: u.id,
            taskId: null,
            type: triggerType, // 'missed_call' | 'voicemail'
            message: notifMessage,
            linkPath,
            isRead: false,
          })),
        );
      }

      // Optional: email a configured "missed call alerts" address
      const followupCfg = (tenant.followupTriggerConfig as { missedCall?: { enabled?: boolean; alertEmail?: string } } | null) ?? {};
      const alertEmail = followupCfg.missedCall?.alertEmail;
      if (alertEmail) {
        const emailConfig = {
          provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
          config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };
        const subject = isVoicemail
          ? `Voicemail received — ${customer?.name ?? callFrom}`
          : `Missed call — ${customer?.name ?? callFrom}`;
        const body = [
          isVoicemail ? "A voicemail was received." : "A missed call was received.",
          customer ? `Customer: ${customer.name}` : `From: ${callFrom}`,
          `To: ${callTo}`,
          customer ? `\nView the thread: https://app.divine-edge.com/communications?customerId=${customer.id}` : "",
        ].filter(Boolean).join("\n");
        await sendEmail(emailConfig, alertEmail, subject, body).catch(() => {/* non-fatal */});
      }
    }

    res.sendStatus(200);
    return;
  }

  if (!from || !body) {
    res.sendStatus(200); // Always 200 to prevent retries
    return;
  }

  // Try to match the inbound number to a tenant's mainPhoneNumber or marketingPhoneNumber
  const tenants = await db
    .select()
    .from(tenantsTable)
    .where(
      or(
        eq(tenantsTable.mainPhoneNumber, to),
        eq(tenantsTable.marketingPhoneNumber, to),
      ),
    );

  if (tenants.length === 0) {
    res.sendStatus(200);
    return;
  }

  for (const tenant of tenants) {
    // Try to match caller to a customer
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(
        and(
          eq(customersTable.tenantId, tenant.id),
          or(
            eq(customersTable.phone, from),
            eq(customersTable.secondaryPhone ?? "", from),
          ),
        ),
      )
      .limit(1);

    await db.insert(communicationsLogTable).values({
      tenantId: tenant.id,
      customerId: customer?.id ?? null,
      direction: "inbound",
      channel: "sms",
      fromAddress: from,
      toAddress: to,
      body,
      status: "received",
      messageType: "manual",
    });

    // Check for opt-out keywords
    const normalizedBody = body.trim().toUpperCase();
    if (["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(normalizedBody) && customer) {
      await db.update(customersTable)
        .set({ smsOptOut: true })
        .where(eq(customersTable.id, customer.id));
    }
    // Opt back in
    if (["START", "YES", "UNSTOP"].includes(normalizedBody) && customer) {
      await db.update(customersTable)
        .set({ smsOptOut: false })
        .where(eq(customersTable.id, customer.id));
    }
  }

  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/send-reminder — manual "send reminder now" override
// ---------------------------------------------------------------------------
router.post("/jobs/:id/send-reminder", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const jobId = parseInt(req.params.id, 10);
  const { channel } = req.body as { channel?: "sms" | "email" | "both" };

  const [[row], [tenant]] = await Promise.all([
    db.select({ job: jobsTable, customer: customersTable, propertyAddress: propertiesTable.address })
      .from(jobsTable)
      .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
      .limit(1),
    db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
  ]);

  if (!row?.job) { res.status(404).json({ error: "Job not found" }); return; }
  if (!row.customer) { res.status(422).json({ error: "Job has no customer" }); return; }
  if (row.job.archivedAt || row.customer.archivedAt) {
    res.status(409).json({ error: "Archived jobs and customers cannot receive reminders" });
    return;
  }
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const { job, customer, propertyAddress } = row;
  const companyName = tenant.name;
  const sendChannels = channel === "both" ? ["sms", "email"] : [channel ?? "sms"];

  const { buildReminderSmsBody, buildReminderEmailBody, sendEmail: sendEmailNow } = await import("../lib/emailProvider");
  const { sendSms: sendSmsNow } = await import("../lib/smsProvider");

  const results: string[] = [];

  if (sendChannels.includes("sms") && customer.phone && !customer.smsOptOut) {
    const smsBody = buildReminderSmsBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress: propertyAddress ?? null,
      companyName,
    });
    const smsConfig: SmsProviderConfig = {
      platform: (tenant.phonePlatform as "openphone" | "grasshopper" | "twilio" | "quo" | null) ?? null,
      config: (tenant.phonePlatformConfig as Record<string, string>) ?? {},
      fromNumber: tenant.mainPhoneNumber ?? null,
    };
    const r = await sendSms(smsConfig, customer.phone, smsBody);
    await db.insert(communicationsLogTable).values({
      tenantId,
      customerId: customer.id,
      direction: "outbound",
      channel: "sms",
      fromAddress: tenant.mainPhoneNumber ?? null,
      toAddress: customer.phone,
      body: smsBody,
      status: r.success ? "sent" : "failed",
      externalId: r.externalId ?? null,
      messageType: "manual",
      jobId,
    });
    if (r.success) results.push("sms");
  }

  if (sendChannels.includes("email") && customer.email && !customer.emailOptOut) {
    const { subject, body } = buildReminderEmailBody({
      customerName: customer.name.split(" ")[0] ?? customer.name,
      jobTitle: job.title,
      scheduledAt: job.scheduledAt,
      propertyAddress: propertyAddress ?? null,
      companyName,
    });
    const emailConfig: EmailProviderConfig = {
      provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
      config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
      fromAddress: (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
    };
    const r = await sendEmail(emailConfig, customer.email, subject, body);
    await db.insert(communicationsLogTable).values({
      tenantId,
      customerId: customer.id,
      direction: "outbound",
      channel: "email",
      toAddress: customer.email,
      subject,
      body,
      status: r.success ? "sent" : "failed",
      externalId: r.externalId ?? null,
      messageType: "manual",
      jobId,
    });
    if (r.success) results.push("email");
  }

  res.json({ sent: results, jobId });
});

// ---------------------------------------------------------------------------
// GET /communications/quo/calls — list recent calls from the connected Quo number
// ---------------------------------------------------------------------------
router.get("/communications/quo/calls", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const cfg = (tenant.phonePlatformConfig as Record<string, string>) ?? {};
  const apiKey = cfg["apiKey"] ?? "";
  const phoneNumberId = cfg["quoPhoneNumberId"] ?? "";

  if (tenant.phonePlatform !== "quo" || !apiKey || !phoneNumberId) {
    res.status(400).json({ error: "Quo is not configured for this tenant" });
    return;
  }

  const result = await listQuoCalls(apiKey, phoneNumberId, { maxResults: 50 });
  if (!result.success) { res.status(502).json({ error: result.error }); return; }

  const calls = await Promise.all(result.calls.map(async call => {
    const counterparty = (call.participants ?? [])[0] ?? null;
    const [customer] = counterparty
      ? await db
          .select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable)
          .where(
            and(
              eq(customersTable.tenantId, tenantId),
              or(eq(customersTable.phone, counterparty), eq(customersTable.secondaryPhone ?? "", counterparty)),
            ),
          )
          .limit(1)
      : [];

    return {
      id: call.id,
      direction: call.direction ?? "incoming",
      status: call.status ?? "completed",
      participants: call.participants ?? [],
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      duration: call.duration ?? null,
      voicemailUrl: call.voicemail?.url ?? null,
      createdAt: call.createdAt ?? new Date().toISOString(),
    };
  }));

  res.json(calls);
});

// ---------------------------------------------------------------------------
// POST /communications/quo/calls/:callId/create-task — turn a call into an internal task
// ---------------------------------------------------------------------------
router.post("/communications/quo/calls/:callId/create-task", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const callId = req.params.callId;
  const { title, assignedToRole } = req.body as { title?: string; assignedToRole?: string };

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const cfg = (tenant.phonePlatformConfig as Record<string, string>) ?? {};
  const apiKey = cfg["apiKey"] ?? "";

  if (tenant.phonePlatform !== "quo" || !apiKey) {
    res.status(400).json({ error: "Quo is not configured for this tenant" });
    return;
  }

  const result = await getQuoCallById(apiKey, callId);
  if (!result.success) { res.status(404).json({ error: result.error }); return; }

  const call = result.call;
  const counterparty = (call.participants ?? [])[0] ?? null;
  const [customer] = counterparty
    ? await db
        .select()
        .from(customersTable)
        .where(
          and(
            eq(customersTable.tenantId, tenantId),
            or(eq(customersTable.phone, counterparty), eq(customersTable.secondaryPhone ?? "", counterparty)),
          ),
        )
        .limit(1)
    : [];

  const isVoicemail = !!call.voicemail?.url;
  const defaultTitle = customer
    ? `Call back ${customer.name}${isVoicemail ? " (left a voicemail)" : ""}`
    : `Call back ${counterparty ?? "unknown number"}${isVoicemail ? " (left a voicemail)" : ""}`;

  const [task] = await db.insert(internalTasksTable).values({
    tenantId,
    title: title ?? defaultTitle,
    description: `From Quo call ${call.id}${counterparty ? ` (${counterparty})` : ""}${isVoicemail ? ` — voicemail: ${call.voicemail?.url}` : ""}`,
    taskType: "call_customer",
    createdById: userId,
    assignedToRole: assignedToRole ?? "admin_office",
    priority: isVoicemail ? "high" : "normal",
    status: "open",
    contextType: customer ? "customer" : null,
    contextId: customer?.id ?? null,
  }).returning();

  res.status(201).json({
    id: task.id,
    tenantId: task.tenantId,
    title: task.title,
    description: task.description,
    taskType: task.taskType,
    createdById: task.createdById,
    createdByName: null,
    assignedToUserId: task.assignedToUserId ?? null,
    assignedToName: null,
    assignedToRole: task.assignedToRole ?? null,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate ?? null,
    contextType: task.contextType ?? null,
    contextId: task.contextId ?? null,
    contextLabel: customer?.name ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    rejectionReason: task.rejectionReason ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });
});

export default router;
