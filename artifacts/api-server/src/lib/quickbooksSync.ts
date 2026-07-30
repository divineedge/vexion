/**
 * Stripe → QuickBooks sync
 *
 * Called (fire-and-forget) whenever an invoice is marked as paid, whether by
 * a staff member in the admin UI or by the Stripe webhook. It:
 *
 *  1. Loads the tenant's QuickBooks credentials (if QB is connected).
 *  2. Refreshes the access token if the current one is expired or rejected.
 *  3. Finds or creates the matching Customer in QBO by display name.
 *  4. Finds or creates the matching Invoice in QBO by DocNumber.
 *  5. Records a Payment in QBO linked to that invoice.
 *  6. Writes a row to integration_sync_logs.
 *  7. Persists updated tokens + sync state back to the tenant record.
 */

import { db, tenantsTable, invoicesTable, customersTable, integrationSyncLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptSecretConfig, encryptSecretConfig } from "./secretsCrypto";
import {
  refreshQuickBooksToken,
  findOrCreateQBOCustomer,
  findOrCreateQBOInvoice,
  recordPaymentInQBO,
  type QuickBooksConfig,
} from "./quickbooksProvider";
import { logger } from "./logger";

interface IntegrationState {
  connected: boolean;
  connectedAt?: string;
  lastSyncedAt?: string;
  lastSyncStatus?: "success" | "error";
  errorCount: number;
  encryptedConfig?: string;
  lastAlertSentAt?: string;
  pendingOAuth?: { nonce: string; userId: number; expiresAt: string };
}

async function loadQBState(tenantId: number): Promise<{ state: IntegrationState; config: QuickBooksConfig } | null> {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return null;
  if (!tenant.quickbooksEnabled) return null;

  const all = (tenant.integrationsConfig as Record<string, IntegrationState>) ?? {};
  const state: IntegrationState = all["quickbooks"] ?? { connected: false, errorCount: 0 };
  if (!state.connected || !state.encryptedConfig) return null;

  const config = decryptSecretConfig(state.encryptedConfig) as QuickBooksConfig;
  if (!config.accessToken || !config.realmId) return null;

  return { state, config };
}

async function persistQBState(
  tenantId: number,
  config: QuickBooksConfig,
  patch: Partial<IntegrationState>,
) {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return;
  const all = (tenant.integrationsConfig as Record<string, IntegrationState>) ?? {};
  const current: IntegrationState = all["quickbooks"] ?? { connected: false, errorCount: 0 };
  all["quickbooks"] = {
    ...current,
    ...patch,
    encryptedConfig: encryptSecretConfig(config as Record<string, unknown>),
  };
  await db.update(tenantsTable).set({ integrationsConfig: all }).where(eq(tenantsTable.id, tenantId));
}

async function logSync(
  tenantId: number,
  status: "success" | "error",
  message: string,
  detail: Record<string, unknown> = {},
) {
  await db.insert(integrationSyncLogsTable).values({
    tenantId,
    integration: "quickbooks",
    action: "push",
    status,
    message,
    detail,
  }).catch(err => logger.warn({ err }, "QBO sync: failed to write sync log"));
}

/**
 * Main entry point. Safe to call fire-and-forget — never throws.
 */
export async function syncInvoicePaymentToQBO(tenantId: number, invoiceId: number): Promise<void> {
  try {
    // 1. Load QB config
    const loaded = await loadQBState(tenantId);
    if (!loaded) return; // QB not connected — silently skip

    let { state, config } = loaded;

    // 2. Load invoice + customer from DB
    const [row] = await db
      .select({ invoice: invoicesTable, customer: customersTable })
      .from(invoicesTable)
      .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId)));

    if (!row?.invoice) {
      await logSync(tenantId, "error", `Invoice ${invoiceId} not found`, { invoiceId });
      return;
    }

    const { invoice, customer } = row;
    const customerName = customer?.name ?? `Customer #${invoice.customerId}`;
    const invoiceTotal = typeof invoice.total === "string" ? parseFloat(invoice.total) : (invoice.total ?? 0);
    const lineItems = (invoice.lineItems as Array<{ description: string; unitPrice: number; quantity: number }> ?? []).map(li => ({
      description: li.description ?? "Service",
      amount: parseFloat(String(li.unitPrice ?? 0)) * (li.quantity ?? 1),
    }));
    const paidDate = invoice.paidAt ? invoice.paidAt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
    const createdDate = invoice.createdAt ? invoice.createdAt.toISOString().split("T")[0] : paidDate;

    // Helper: run a QBO step, auto-retry once after token refresh on 401
    async function withTokenRetry<T>(
      fn: (cfg: QuickBooksConfig) => Promise<{ success: boolean; error?: string } & T>,
    ): Promise<({ success: boolean; error?: string } & T)> {
      let result = await fn(config);
      if (!result.success && result.error?.includes("401")) {
        // Attempt a token refresh
        if (!config.clientId || !config.clientSecret || !config.refreshToken) {
          return result;
        }
        const refreshResult = await refreshQuickBooksToken(config);
        if (refreshResult.success && refreshResult.accessToken) {
          config = { ...config, accessToken: refreshResult.accessToken, refreshToken: refreshResult.refreshToken ?? config.refreshToken };
          result = await fn(config);
        }
      }
      return result;
    }

    // 3. Find or create QBO Customer
    const custResult = await withTokenRetry(cfg => findOrCreateQBOCustomer(cfg, customerName));
    if (!custResult.success || !custResult.qboCustomerId) {
      await persistQBState(tenantId, config, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: "error",
        errorCount: (state.errorCount ?? 0) + 1,
      });
      await logSync(tenantId, "error", `Failed to find/create QBO customer: ${custResult.error}`, { invoiceId, customerName });
      return;
    }

    // 4. Find or create QBO Invoice
    const invResult = await withTokenRetry(cfg => findOrCreateQBOInvoice(cfg, {
      docNumber: invoice.invoiceNumber,
      qboCustomerId: custResult.qboCustomerId!,
      total: invoiceTotal,
      lineItems,
      txnDate: createdDate,
    }));
    if (!invResult.success || !invResult.qboInvoiceId) {
      await persistQBState(tenantId, config, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: "error",
        errorCount: (state.errorCount ?? 0) + 1,
      });
      await logSync(tenantId, "error", `Failed to find/create QBO invoice: ${invResult.error}`, { invoiceId, invoiceNumber: invoice.invoiceNumber });
      return;
    }

    // 5. Record Payment in QBO
    const pmtResult = await withTokenRetry(cfg => recordPaymentInQBO(cfg, {
      qboCustomerId: custResult.qboCustomerId!,
      qboInvoiceId: invResult.qboInvoiceId!,
      amount: invoiceTotal,
      paymentDate: paidDate,
    }));
    if (!pmtResult.success) {
      await persistQBState(tenantId, config, {
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: "error",
        errorCount: (state.errorCount ?? 0) + 1,
      });
      await logSync(tenantId, "error", `Failed to record QBO payment: ${pmtResult.error}`, { invoiceId, qboInvoiceId: invResult.qboInvoiceId });
      return;
    }

    // 6. All good — persist updated tokens + success state
    await persistQBState(tenantId, config, {
      lastSyncedAt: new Date().toISOString(),
      lastSyncStatus: "success",
      errorCount: 0,
    });
    await logSync(tenantId, "success", `Payment synced to QuickBooks for invoice ${invoice.invoiceNumber}`, {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      qboCustomerId: custResult.qboCustomerId,
      qboInvoiceId: invResult.qboInvoiceId,
      qboPaymentId: pmtResult.qboPaymentId,
      amount: invoiceTotal,
    });

    logger.info({ tenantId, invoiceId, qboPaymentId: pmtResult.qboPaymentId }, "QBO payment sync succeeded");
  } catch (err) {
    // Never let sync errors surface to callers
    logger.error({ err, tenantId, invoiceId }, "QBO sync: unexpected error");
    await logSync(tenantId, "error", `Unexpected sync error: ${err instanceof Error ? err.message : String(err)}`, { invoiceId }).catch(() => {});
  }
}
