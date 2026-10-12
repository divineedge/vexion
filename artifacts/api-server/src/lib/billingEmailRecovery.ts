import { db, billingEmailQueueTable, activityLogTable } from "@workspace/db";
import { and, eq, sql, or } from "drizzle-orm";

// A timeout is not proof of failure. Never automatically release stale claims.
export async function detectInterruptedBillingEmails(tenantId?: number) {
  await db.update(billingEmailQueueTable).set({
    status: "interrupted",
    errorMsg: "Delivery was interrupted. Check the original provider's logs before retrying; the email may already have been accepted.",
  }).where(and(
    or(
      and(eq(billingEmailQueueTable.status, "processing"),
        sql`coalesce(${billingEmailQueueTable.lastAttemptAt}, ${billingEmailQueueTable.updatedAt}) < now() - interval '15 minutes'`),
      // Older senders retried transport errors automatically. Quarantine those
      // entries on upgrade; verified retries explicitly reset attempts to zero.
      and(eq(billingEmailQueueTable.status, "pending"), sql`${billingEmailQueueTable.attempts} > 0`),
    ),
    tenantId === undefined ? undefined : eq(billingEmailQueueTable.tenantId, tenantId),
  ));
}

export function providerVerificationInstructions(provider: string | null): string {
  switch (provider) {
    case "gmail": return "Check the connected Gmail account's Sent mail for this recipient, invoice number and attempt time.";
    case "smtp": return "Check the original SMTP server's queue and delivery logs, including accepted or deferred messages.";
    case "sendgrid": return "Check SendGrid Email Activity for accepted, processed, deferred or delivered events.";
    case "mailgun": return "Check the original Mailgun domain's events for accepted, queued or delivered messages.";
    case "resend": return "Check the original Resend account's Emails log and message ID for accepted or sent messages.";
    case "none": return "No email provider was configured. Confirm no real email was sent before retrying after setup.";
    default: return "This legacy attempt has no saved provider. Identify the provider used at the attempt time and check its delivery logs.";
  }
}

export type DeliveryVerification = { outcome: "sent" | "not_sent"; evidence: string };

export async function resolveBillingEmail(tenantId: number, userId: number, id: number, verification?: DeliveryVerification) {
  return db.transaction(async tx => {
    // The sender's dedicated session holds this lock during the network operation. Even an
    // apparently stale claim cannot be retried while its worker is still alive.
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(672, ${id}) as acquired`);
    if (!lock.rows[0]?.acquired) throw new Error("The delivery worker is still active. Try again after it finishes.");
    const [entry] = await tx.select().from(billingEmailQueueTable)
      .where(and(eq(billingEmailQueueTable.id, id), eq(billingEmailQueueTable.tenantId, tenantId))).for("update");
    if (!entry) throw new Error("Email queue entry not found.");
    if (!["interrupted", "failed"].includes(entry.status)) throw new Error("Only failed or interrupted deliveries can be resolved.");
    // Legacy failures also require verification: earlier senders treated network
    // timeouts as failures even though the provider could have accepted mail.
    if (!verification || !["sent", "not_sent"].includes(verification.outcome) || verification.evidence.trim().length < 10) {
      throw new Error("Check the original provider and record the evidence before resolving this delivery.");
    }
    const status = verification.outcome === "sent" ? "sent" : "pending";
    await tx.update(billingEmailQueueTable).set({
      status, attempts: status === "pending" ? 0 : entry.attempts,
      errorMsg: null,
    }).where(eq(billingEmailQueueTable.id, id));
    await tx.insert(activityLogTable).values({
      tenantId, userId, entityId: entry.invoiceId, type: "invoice_email_verified",
      message: `Email queue ${id}: ${entry.deliveryProvider ?? "unknown provider"} verified ${verification.outcome}. Evidence: ${verification.evidence.trim()}`,
    });
    return status;
  });
}
