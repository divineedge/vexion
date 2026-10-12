import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, tenantsTable, usersTable, customersTable, invoicesTable, billingEmailQueueTable, activityLogTable } from "@workspace/db";
import { detectInterruptedBillingEmails, resolveBillingEmail, providerVerificationInstructions } from "./billingEmailRecovery";
import { processEmailQueue, enqueueInvoiceEmail } from "./billingScheduler";
import { sendEmail } from "./emailProvider";
import { withBillingEmailWorkerGuard } from "./billingEmailWorkerGuard";

vi.mock("./emailProvider", () => ({ sendEmail: vi.fn() }));

describe("interrupted invoice email recovery", () => {
  let tenantId: number, userId: number, invoiceId: number;
  beforeAll(async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name: "Email recovery QA", slug: randomUUID(), emailProvider: "resend" }).returning();
    tenantId = tenant.id;
    const [user] = await db.insert(usersTable).values({ tenantId, name: "Recovery QA", email: `${randomUUID()}@example.invalid`, role: "company_owner" }).returning();
    userId = user.id;
    const [customer] = await db.insert(customersTable).values({ tenantId, name: "Recovery QA", email: "recovery@example.invalid", phone: "" }).returning();
    const [invoice] = await db.insert(invoicesTable).values({ tenantId, customerId: customer.id, invoiceNumber: "RECOVERY-QA", status: "sent", publicToken: randomUUID() }).returning();
    invoiceId = invoice.id;
  });
  afterAll(async () => {
    await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenantId));
    await db.delete(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenantId));
    await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenantId));
    await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
    await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });
  const createEntry = async (status: string, stale = false) => (await db.insert(billingEmailQueueTable).values({
    tenantId, invoiceId, status, attempts: status === "pending" ? 0 : 1, deliveryProvider: "resend",
    lastAttemptAt: new Date(Date.now() - (stale ? 20 * 60_000 : 0)),
  }).returning())[0];
  const read = async (id: number) => (await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.id, id)))[0];
  const evidence = "Resend original account event log checked: confirmed outcome.";

  it("exposes only stale processing claims and refuses blind or cross-tenant retries", async () => {
    const stale = await createEntry("processing", true);
    const fresh = await createEntry("processing");
    await detectInterruptedBillingEmails(tenantId);
    expect((await read(stale.id)).status).toBe("interrupted");
    expect((await read(fresh.id)).status).toBe("processing");
    await expect(resolveBillingEmail(tenantId, userId, stale.id)).rejects.toThrow("evidence");
    await expect(resolveBillingEmail(tenantId + 100000, userId, stale.id, { outcome: "sent", evidence })).rejects.toThrow("not found");
    await expect(resolveBillingEmail(tenantId, userId, fresh.id, { outcome: "not_sent", evidence })).rejects.toThrow("Only failed");
    await resolveBillingEmail(tenantId, userId, stale.id, { outcome: "sent", evidence });
    expect((await read(stale.id)).status).toBe("sent");
    await expect(resolveBillingEmail(tenantId, userId, stale.id, { outcome: "not_sent", evidence })).rejects.toThrow("Only failed");
    await db.delete(billingEmailQueueTable).where(eq(billingEmailQueueTable.id, fresh.id));
  });

  it("permits exactly one verified retry and records an audit event", async () => {
    const entry = await createEntry("interrupted", true);
    const results = await Promise.allSettled([
      resolveBillingEmail(tenantId, userId, entry.id, { outcome: "not_sent", evidence }),
      resolveBillingEmail(tenantId, userId, entry.id, { outcome: "not_sent", evidence }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await read(entry.id)).status).toBe("pending");
    expect((await read(entry.id)).attempts).toBe(0);
    const logs = await db.select().from(activityLogTable).where(and(eq(activityLogTable.tenantId, tenantId), eq(activityLogTable.type, "invoice_email_verified")));
    expect(logs.some(l => l.message.includes(evidence))).toBe(true);
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: "Connection dropped after submission" });
    await processEmailQueue(tenantId);
    expect((await read(entry.id)).status).toBe("interrupted");
    await processEmailQueue(tenantId);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    await expect(enqueueInvoiceEmail(tenantId, invoiceId)).rejects.toThrow("unresolved");
    await resolveBillingEmail(tenantId, userId, entry.id, { outcome: "sent", evidence });
  });

  it("blocks recovery while a stale-looking sender is still active; retains provider receipt", async () => {
    const entry = await createEntry("pending");
    let finish!: (result: { success: boolean; externalId: string }) => void;
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    vi.mocked(sendEmail).mockImplementationOnce(() => { started(); return new Promise(r => { finish = r; }); });
    const processing = processEmailQueue(tenantId);
    await ready;
    try {
      await db.update(billingEmailQueueTable).set({ lastAttemptAt: new Date(Date.now() - 20 * 60_000) }).where(eq(billingEmailQueueTable.id, entry.id));
      await detectInterruptedBillingEmails(tenantId);
      await expect(resolveBillingEmail(tenantId, userId, entry.id, { outcome: "not_sent", evidence })).rejects.toThrow("still active");
    } finally {
      finish({ success: true, externalId: "provider-receipt-qa" });
      await processing;
    }
    expect((await read(entry.id)).status).toBe("sent");
    expect((await read(entry.id)).providerMessageId).toBe("provider-receipt-qa");
    expect((await read(entry.id)).deliveryRecipient).toBe("recovery@example.invalid");
  });

  it("does not call a console-only email sent and distinguishes confirmed failure", async () => {
    const entry = await createEntry("pending");
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: true, devOnly: true });
    await processEmailQueue(tenantId);
    expect((await read(entry.id)).status).toBe("failed");
    await resolveBillingEmail(tenantId, userId, entry.id, { outcome: "not_sent", evidence });
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, definitiveFailure: true, error: "Invalid API key" });
    await processEmailQueue(tenantId);
    expect((await read(entry.id)).status).toBe("failed");
  });

  it("gives provider-specific verification directions and handles legacy entries", () => {
    for (const provider of ["resend", "gmail", "smtp", "sendgrid", "mailgun", "none", null]) {
      expect(providerVerificationInstructions(provider).length).toBeGreaterThan(30);
    }
    expect(providerVerificationInstructions(null)).toContain("legacy");
  });

  it("quarantines legacy attempted pending rows before any provider call, including exhausted attempts", async () => {
    vi.mocked(sendEmail).mockClear();
    const legacy = await createEntry("pending");
    const exhausted = await createEntry("pending");
    await db.update(billingEmailQueueTable).set({ attempts: 1 }).where(eq(billingEmailQueueTable.id, legacy.id));
    await db.update(billingEmailQueueTable).set({ attempts: 3 }).where(eq(billingEmailQueueTable.id, exhausted.id));
    await processEmailQueue(tenantId);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await read(legacy.id)).status).toBe("interrupted");
    expect((await read(exhausted.id)).status).toBe("interrupted");
    await resolveBillingEmail(tenantId, userId, legacy.id, { outcome: "sent", evidence });
    await resolveBillingEmail(tenantId, userId, exhausted.id, { outcome: "sent", evidence });
  });

  it("keeps the query pool available with twelve concurrent guarded sends", async () => {
    let release!: () => void;
    let fourStarted!: () => void;
    const blockedNetwork = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { fourStarted = r; });
    let active = 0, peak = 0, completed = 0;
    const workers = Array.from({ length: 12 }, (_, i) => withBillingEmailWorkerGuard(1000000000 + i, async () => {
      await db.execute(sql`select 1`);
      active++;
      peak = Math.max(peak, active);
      if (active === 4) fourStarted();
      await blockedNetwork;
      await db.execute(sql`select 1`);
      active--;
      completed++;
    }));
    try {
      await started;
      // All ordinary pooled connections remain available during provider waits.
      await Promise.race([
        Promise.all(Array.from({ length: 12 }, () => db.execute(sql`select 1`))),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Query pool stalled")), 2000)),
      ]);
    } finally {
      release();
      await Promise.all(workers);
    }
    expect(completed).toBe(12);
    expect(peak).toBeLessThanOrEqual(4);
  }, 15000);
});
