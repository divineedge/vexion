import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, tenantsTable, usersTable, vendorsTable, expenseEntriesTable, bankTransactionsTable, integrationSyncLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { encryptSecretConfig, decryptSecretConfig, maskSecret } from "../lib/secretsCrypto";
import { testBankConnection, fetchBankTransactions, type BankSyncConfig } from "../lib/plaidProvider";
import { testMailchimpConnection, type MailchimpConfig } from "../lib/mailchimpProvider";
import { testLobConnection, type LobConfig } from "../lib/lobProvider";
import { buildQuickBooksAuthorizeUrl, exchangeQuickBooksCode, testQuickBooksConnection, type QuickBooksConfig } from "../lib/quickbooksProvider";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const INTEGRATIONS = ["bank", "mailchimp", "lob", "quickbooks"] as const;
type IntegrationName = typeof INTEGRATIONS[number];

/** Number of consecutive failures before the owner is alerted. */
const ALERT_THRESHOLD = 3;
/** Minimum hours between alert emails for the same integration (rate-limit). */
const ALERT_COOLDOWN_HOURS = 24;

interface IntegrationState {
  connected: boolean;
  connectedAt?: string;
  lastSyncedAt?: string;
  lastSyncStatus?: "success" | "error";
  errorCount: number;
  encryptedConfig?: string;
  /** ISO timestamp of the last alert email sent for this integration. */
  lastAlertSentAt?: string;
  /** Single-use, short-lived OAuth CSRF binding for the QuickBooks authorization-code flow. */
  pendingOAuth?: { nonce: string; userId: number; expiresAt: string };
}

/**
 * Send an alert email to the tenant owner when an integration crosses the
 * consecutive-failure threshold (previousErrorCount < threshold <= newErrorCount).
 * Rate-limited to once per ALERT_COOLDOWN_HOURS.
 *
 * `lastAlertSentAt` is only persisted when the email is confirmed sent; a send
 * failure leaves it unchanged so the next attempt can retry.
 */
async function maybeAlertOwner(
  tenantId: number,
  name: IntegrationName,
  previousErrorCount: number,
  state: IntegrationState,
  errorMessage: string | undefined,
): Promise<IntegrationState> {
  // Only fire on the crossing (e.g. 2 → 3), not on every subsequent failure.
  const crossed = previousErrorCount < ALERT_THRESHOLD && state.errorCount >= ALERT_THRESHOLD;
  if (!crossed) return state;

  // Within the cooldown window, suppress repeated alerts.
  if (state.lastAlertSentAt) {
    const hoursSinceLast = (Date.now() - new Date(state.lastAlertSentAt).getTime()) / 3_600_000;
    if (hoursSinceLast < ALERT_COOLDOWN_HOURS) return state;
  }

  // Resolve owner email: prefer businessEmail on tenant, fall back to owner user.
  const tenant = await getTenant(tenantId);
  let ownerEmail = tenant.businessEmail ?? null;
  if (!ownerEmail) {
    const [ownerUser] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "owner")))
      .limit(1);
    ownerEmail = ownerUser?.email ?? null;
  }

  if (!ownerEmail) {
    logger.warn({ tenantId, integration: name }, "Integration alert: no owner email found, skipping notification");
    return state;
  }

  const displayName = DISPLAY[name].displayName;
  const subject = `Action required: ${displayName} integration is failing`;
  const body = [
    `Hi,`,
    ``,
    `Your ${displayName} integration has failed ${state.errorCount} time(s) in a row.`,
    ``,
    errorMessage ? `Last error: ${errorMessage}` : null,
    state.lastSyncedAt ? `Last attempted: ${new Date(state.lastSyncedAt).toLocaleString()}` : null,
    ``,
    `Please log in to Settings → Integrations to review the sync log and reconnect or update your credentials.`,
    ``,
    `You will not receive another alert for this integration for ${ALERT_COOLDOWN_HOURS} hours.`,
  ].filter(l => l !== null).join("\n");

  const emailProviderConfig: EmailProviderConfig = {
    provider: (tenant.emailProvider as EmailProviderConfig["provider"]) ?? null,
    config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
    fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
  };

  let sendResult: { success: boolean; error?: string } = { success: false };
  try {
    sendResult = await sendEmail(emailProviderConfig, ownerEmail, subject, body);
  } catch (err) {
    logger.error({ tenantId, integration: name, err }, "Integration alert: exception sending email");
  }

  // Only stamp lastAlertSentAt if delivery was confirmed — a failed send must not
  // suppress the next attempt.
  if (!sendResult.success) {
    logger.warn({ tenantId, integration: name, error: sendResult.error }, "Integration alert: email send failed, will retry next crossing");
    return state;
  }

  const updated: IntegrationState = { ...state, lastAlertSentAt: new Date().toISOString() };
  await saveState(tenantId, name, updated);
  return updated;
}

async function getTenant(tenantId: number) {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) throw new Error("Tenant not found");
  return tenant;
}

function getAllStates(tenant: typeof tenantsTable.$inferSelect): Record<IntegrationName, IntegrationState> {
  const raw = (tenant.integrationsConfig as Record<string, IntegrationState>) ?? {};
  const result = {} as Record<IntegrationName, IntegrationState>;
  for (const name of INTEGRATIONS) {
    result[name] = raw[name] ?? { connected: false, errorCount: 0 };
  }
  return result;
}

async function saveState(tenantId: number, name: IntegrationName, state: IntegrationState) {
  const tenant = await getTenant(tenantId);
  const all = getAllStates(tenant);
  all[name] = state;
  await db.update(tenantsTable).set({ integrationsConfig: all }).where(eq(tenantsTable.id, tenantId));
}

function maskedConfig(name: IntegrationName, config: Record<string, unknown>): Record<string, unknown> {
  const secretFields: Record<IntegrationName, string[]> = {
    bank: ["secret", "accessToken"],
    mailchimp: ["apiKey"],
    lob: ["apiKey"],
    quickbooks: ["clientSecret", "accessToken", "refreshToken"],
  };
  const masked: Record<string, unknown> = { ...config };
  for (const field of secretFields[name]) {
    if (typeof masked[field] === "string") masked[field] = maskSecret(masked[field] as string);
  }
  return masked;
}

const DISPLAY: Record<IntegrationName, { displayName: string; description: string }> = {
  bank: { displayName: "Bank Sync", description: "Import bank transactions into the Vendor & Expense Ledger (Plaid)." },
  mailchimp: { displayName: "Mailchimp", description: "Push customers and tags to a Mailchimp audience for email marketing." },
  lob: { displayName: "Lob Print & Mail", description: "Mail physical invoices and letters to customers." },
  quickbooks: { displayName: "QuickBooks Online", description: "One-way push of invoices and customers to QuickBooks." },
};

router.get("/integrations", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);

  res.json(INTEGRATIONS.map(name => ({
    name,
    ...DISPLAY[name],
    connected: states[name].connected,
    connectedAt: states[name].connectedAt ?? null,
    lastSyncedAt: states[name].lastSyncedAt ?? null,
    lastSyncStatus: states[name].lastSyncStatus ?? null,
    errorCount: states[name].errorCount ?? 0,
  })));
});

router.get("/integrations/:name", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const name = req.params.name as IntegrationName;
  if (!INTEGRATIONS.includes(name)) { res.status(404).json({ error: "Unknown integration" }); return; }

  const tenant = await getTenant(tenantId);
  const state = getAllStates(tenant)[name];
  const config = decryptSecretConfig(state.encryptedConfig);

  res.json({
    name,
    ...DISPLAY[name],
    connected: state.connected,
    connectedAt: state.connectedAt ?? null,
    lastSyncedAt: state.lastSyncedAt ?? null,
    lastSyncStatus: state.lastSyncStatus ?? null,
    errorCount: state.errorCount ?? 0,
    config: maskedConfig(name, config),
  });
});

router.patch("/integrations/:name", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const name = req.params.name as IntegrationName;
  if (!INTEGRATIONS.includes(name)) { res.status(404).json({ error: "Unknown integration" }); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);
  const existingConfig = decryptSecretConfig(states[name].encryptedConfig);

  // Merge — never overwrite a saved secret with the masked placeholder the client echoes back.
  const incoming = (req.body.config ?? {}) as Record<string, unknown>;
  const merged = { ...existingConfig };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string" && value.startsWith("••••")) continue;
    if (value !== "" && value != null) merged[key] = value;
  }

  const newState: IntegrationState = {
    ...states[name],
    connected: req.body.connected ?? states[name].connected,
    encryptedConfig: encryptSecretConfig(merged),
    connectedAt: req.body.connected ? (states[name].connectedAt ?? new Date().toISOString()) : states[name].connectedAt,
  };
  await saveState(tenantId, name, newState);
  await db.insert(integrationSyncLogsTable).values({ tenantId, integration: name, action: "connect", status: "success", message: "Configuration saved" });

  res.json({
    name, ...DISPLAY[name],
    connected: newState.connected,
    connectedAt: newState.connectedAt ?? null,
    lastSyncedAt: newState.lastSyncedAt ?? null,
    lastSyncStatus: newState.lastSyncStatus ?? null,
    errorCount: newState.errorCount ?? 0,
    config: maskedConfig(name, merged),
  });
});

router.delete("/integrations/:name", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const name = req.params.name as IntegrationName;
  if (!INTEGRATIONS.includes(name)) { res.status(404).json({ error: "Unknown integration" }); return; }

  await saveState(tenantId, name, { connected: false, errorCount: 0 });
  await db.insert(integrationSyncLogsTable).values({ tenantId, integration: name, action: "disconnect", status: "success", message: "Disconnected" });
  res.sendStatus(204);
});

router.post("/integrations/:name/test", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const name = req.params.name as IntegrationName;
  if (!INTEGRATIONS.includes(name)) { res.status(404).json({ error: "Unknown integration" }); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);
  const config = decryptSecretConfig(states[name].encryptedConfig);

  let result: { success: boolean; error?: string };
  switch (name) {
    case "bank": result = await testBankConnection(config as BankSyncConfig); break;
    case "mailchimp": result = await testMailchimpConnection(config as MailchimpConfig); break;
    case "lob": result = await testLobConnection(config as LobConfig); break;
    case "quickbooks": result = await testQuickBooksConnection(config as QuickBooksConfig); break;
  }

  const prevErrorCount = states[name].errorCount ?? 0;
  const newErrorCount = result.success ? 0 : prevErrorCount + 1;
  let newState: IntegrationState = {
    ...states[name],
    lastSyncedAt: new Date().toISOString(),
    lastSyncStatus: result.success ? "success" : "error",
    errorCount: newErrorCount,
    // Reset the alert cooldown on success so a new failure streak can trigger a fresh alert.
    lastAlertSentAt: result.success ? undefined : states[name].lastAlertSentAt,
  };
  await saveState(tenantId, name, newState);
  await db.insert(integrationSyncLogsTable).values({
    tenantId, integration: name, action: "test",
    status: result.success ? "success" : "error",
    message: result.success ? "Test ping succeeded" : result.error,
  });

  if (!result.success) {
    newState = await maybeAlertOwner(tenantId, name, prevErrorCount, newState, result.error);
  }

  res.json(result);
});

router.get("/integrations/:name/logs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const name = req.params.name as IntegrationName;
  const rows = await db.select().from(integrationSyncLogsTable)
    .where(and(eq(integrationSyncLogsTable.tenantId, tenantId), eq(integrationSyncLogsTable.integration, name)))
    .orderBy(desc(integrationSyncLogsTable.createdAt))
    .limit(50);

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ── Bank Sync: pull transactions + stage them for import ───────────────────

router.post("/integrations/bank/sync", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);
  const config = decryptSecretConfig(states.bank.encryptedConfig) as BankSyncConfig;

  const { transactions, simulated, error } = await fetchBankTransactions(config);
  if (error) {
    const prevErrorCount = states.bank.errorCount ?? 0;
    const errState: IntegrationState = { ...states.bank, lastSyncedAt: new Date().toISOString(), lastSyncStatus: "error", errorCount: prevErrorCount + 1 };
    await saveState(tenantId, "bank", errState);
    await db.insert(integrationSyncLogsTable).values({ tenantId, integration: "bank", action: "sync", status: "error", message: error });
    await maybeAlertOwner(tenantId, "bank", prevErrorCount, errState, error);
    res.status(502).json({ error });
    return;
  }

  let imported = 0;
  for (const t of transactions) {
    const [existing] = await db.select({ id: bankTransactionsTable.id }).from(bankTransactionsTable)
      .where(and(eq(bankTransactionsTable.tenantId, tenantId), eq(bankTransactionsTable.externalId, t.externalId)));
    if (existing) continue;
    await db.insert(bankTransactionsTable).values({
      tenantId, externalId: t.externalId, date: t.date, amount: t.amount,
      description: t.description, merchantName: t.merchantName ?? null, guessedCategory: t.guessedCategory,
    });
    imported++;
  }

  // Reset errorCount and clear the alert cooldown so a future failure streak triggers a fresh alert.
  await saveState(tenantId, "bank", { ...states.bank, lastSyncedAt: new Date().toISOString(), lastSyncStatus: "success", errorCount: 0, lastAlertSentAt: undefined });
  await db.insert(integrationSyncLogsTable).values({
    tenantId, integration: "bank", action: "sync", status: "success",
    message: `${imported} new transaction(s) pulled${simulated ? " (simulated feed — connect a live account for real data)" : ""}`,
    detail: { imported, simulated },
  });

  res.json({ imported, simulated });
});

router.get("/bank-transactions", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const { status } = req.query as Record<string, string>;
  const conditions = [eq(bankTransactionsTable.tenantId, tenantId)];
  if (status) conditions.push(eq(bankTransactionsTable.status, status));

  const rows = await db.select().from(bankTransactionsTable).where(and(...conditions)).orderBy(desc(bankTransactionsTable.date));
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/bank-transactions/:id/import", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const { vendorId, category } = req.body as { vendorId?: number; category?: string };

  const [txn] = await db.select().from(bankTransactionsTable).where(and(eq(bankTransactionsTable.id, id), eq(bankTransactionsTable.tenantId, tenantId)));
  if (!txn) { res.status(404).json({ error: "Not found" }); return; }
  if (txn.status !== "pending") { res.status(400).json({ error: "Transaction already processed" }); return; }

  if (vendorId) {
    const [v] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.tenantId, tenantId)));
    if (!v) { res.status(400).json({ error: "Invalid vendorId" }); return; }
  }

  const [expense] = await db.insert(expenseEntriesTable).values({
    tenantId,
    vendorId: vendorId ?? txn.guessedVendorId ?? null,
    date: txn.date,
    amount: txn.amount,
    category: category ?? txn.guessedCategory,
    description: txn.description,
  }).returning();

  const [updated] = await db.update(bankTransactionsTable)
    .set({ status: "imported", importedExpenseId: expense.id })
    .where(eq(bankTransactionsTable.id, id))
    .returning();

  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), expenseId: expense.id });
});

router.post("/bank-transactions/:id/ignore", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(bankTransactionsTable)
    .set({ status: "ignored" })
    .where(and(eq(bankTransactionsTable.id, id), eq(bankTransactionsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

// ── QuickBooks OAuth ─────────────────────────────────────────────────────────

router.get("/integrations/quickbooks/oauth/authorize-url", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);
  const config = decryptSecretConfig(states.quickbooks.encryptedConfig) as QuickBooksConfig;

  // CSRF-bind the flow: a random, single-use nonce is minted for this tenant+user and must be
  // echoed back unmodified in the callback's `state` param, alongside the tenantId prefix. Without
  // this, an attacker could drive the callback with an arbitrary tenantId in `state` and bind their
  // own QuickBooks tokens to a victim tenant.
  const nonce = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await saveState(tenantId, "quickbooks", { ...states.quickbooks, pendingOAuth: { nonce, userId, expiresAt } });

  const redirectUri = `${req.protocol}://${req.get("host")}/api/integrations/quickbooks/oauth/callback`;
  const { url, error } = buildQuickBooksAuthorizeUrl(config, redirectUri, `${tenantId}.${nonce}`);
  if (error) { res.status(400).json({ error }); return; }
  res.json({ url });
});

router.get("/integrations/quickbooks/oauth/callback", async (req, res): Promise<void> => {
  const { code, state, realmId } = req.query as Record<string, string>;
  const separatorIndex = state ? state.indexOf(".") : -1;
  const tenantId = separatorIndex > 0 ? parseInt(state.slice(0, separatorIndex), 10) : NaN;
  const nonce = separatorIndex > 0 ? state.slice(separatorIndex + 1) : "";
  if (!tenantId || !nonce || !code) { res.status(400).send("Missing or malformed code/state"); return; }

  const tenant = await getTenant(tenantId);
  const states = getAllStates(tenant);
  const pending = states.quickbooks.pendingOAuth;

  // Validate the nonce against the one this tenant's admin was issued, using a constant-time
  // comparison, and reject if it's missing, mismatched, or expired. Invalidate it immediately
  // (single-use) so a captured callback URL cannot be replayed.
  const nonceBuffer = Buffer.from(nonce);
  const pendingBuffer = Buffer.from(pending?.nonce ?? "");
  const nonceValid = pending != null
    && nonceBuffer.length === pendingBuffer.length
    && crypto.timingSafeEqual(nonceBuffer, pendingBuffer)
    && new Date(pending.expiresAt).getTime() > Date.now();

  await saveState(tenantId, "quickbooks", { ...states.quickbooks, pendingOAuth: undefined });

  if (!nonceValid) {
    await db.insert(integrationSyncLogsTable).values({ tenantId, integration: "quickbooks", action: "connect", status: "error", message: "OAuth state validation failed (missing, mismatched, expired, or already used)" });
    res.status(400).send("QuickBooks connection failed: invalid or expired authorization request. Please retry from Settings.");
    return;
  }

  const config = decryptSecretConfig(states.quickbooks.encryptedConfig) as QuickBooksConfig;
  const redirectUri = `${req.protocol}://${req.get("host")}/api/integrations/quickbooks/oauth/callback`;
  const result = await exchangeQuickBooksCode(config, code, redirectUri);

  if (!result.success) {
    await db.insert(integrationSyncLogsTable).values({ tenantId, integration: "quickbooks", action: "connect", status: "error", message: result.error });
    res.status(400).send(`QuickBooks connection failed: ${result.error}`);
    return;
  }

  await saveState(tenantId, "quickbooks", {
    ...states.quickbooks,
    pendingOAuth: undefined,
    connected: true,
    connectedAt: new Date().toISOString(),
    encryptedConfig: encryptSecretConfig({ ...config, accessToken: result.accessToken, refreshToken: result.refreshToken, realmId: realmId ?? config.realmId }),
  });
  await db.insert(integrationSyncLogsTable).values({ tenantId, integration: "quickbooks", action: "connect", status: "success", message: "OAuth connection established" });

  res.send("<html><body>QuickBooks connected successfully. You can close this window and return to Settings.</body></html>");
});

export default router;
