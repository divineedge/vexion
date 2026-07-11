/**
 * Bank Sync provider (Plaid-style). Mirrors the smsProvider/emailProvider pattern:
 * attempts a real API call when credentials are configured, and falls back to a
 * clearly-labeled simulated feed in dev mode so the UI can be exercised without
 * a live Plaid app registration.
 */
import { logger } from "./logger";

export interface BankSyncConfig {
  clientId?: string;
  secret?: string;
  accessToken?: string;
  /** 'sandbox' | 'development' | 'production' */
  environment?: string;
}

export interface BankTestResult {
  success: boolean;
  error?: string;
  institutionName?: string;
  simulated?: boolean;
}

export interface BankTransactionResult {
  externalId: string;
  date: string;
  amount: number;
  description: string;
  merchantName?: string | null;
  guessedCategory: string;
}

function plaidBaseUrl(environment?: string): string {
  return environment === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";
}

export async function testBankConnection(config: BankSyncConfig): Promise<BankTestResult> {
  if (!config.clientId || !config.secret || !config.accessToken) {
    return { success: false, error: "Missing clientId, secret, or accessToken" };
  }
  try {
    const res = await fetch(`${plaidBaseUrl(config.environment)}/accounts/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, access_token: config.accessToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Plaid error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { item?: { institution_id?: string } };
    return { success: true, institutionName: data.item?.institution_id ?? "Connected" };
  } catch (err) {
    logger.warn({ err }, "Plaid test connection failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Plaid" };
  }
}

export async function fetchBankTransactions(config: BankSyncConfig): Promise<{ transactions: BankTransactionResult[]; simulated: boolean; error?: string }> {
  if (!config.clientId || !config.secret || !config.accessToken) {
    // Dev-mode fallback: a small simulated feed so the Import flow can be exercised.
    const today = new Date();
    const iso = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
    return {
      simulated: true,
      transactions: [
        { externalId: `sim-${iso(1)}-fuel`, date: iso(1), amount: 58.32, description: "SHELL OIL 12345", merchantName: "Shell", guessedCategory: "fuel" },
        { externalId: `sim-${iso(3)}-supply`, date: iso(3), amount: 214.5, description: "SITEONE LANDSCAPE SUPPLY", merchantName: "SiteOne", guessedCategory: "materials" },
        { externalId: `sim-${iso(5)}-repair`, date: iso(5), amount: 340.0, description: "AAA MOWER REPAIR SHOP", merchantName: "AAA Mower Repair", guessedCategory: "equipment" },
      ],
    };
  }

  try {
    const res = await fetch(`${plaidBaseUrl(config.environment)}/transactions/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, access_token: config.accessToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { simulated: false, transactions: [], error: `Plaid error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { added?: Array<{ transaction_id: string; date: string; amount: number; name: string; merchant_name?: string; category?: string[] }> };
    const transactions = (data.added ?? []).map(t => ({
      externalId: t.transaction_id,
      date: t.date,
      amount: t.amount,
      description: t.name,
      merchantName: t.merchant_name ?? null,
      guessedCategory: (t.category?.[0] ?? "other").toLowerCase(),
    }));
    return { simulated: false, transactions };
  } catch (err) {
    logger.warn({ err }, "Plaid transaction sync failed");
    return { simulated: false, transactions: [], error: err instanceof Error ? err.message : "Network error contacting Plaid" };
  }
}
