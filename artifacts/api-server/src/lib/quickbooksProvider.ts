/**
 * QuickBooks Online provider — OAuth2 authorization-code flow plus a one-way
 * push of invoices/customers/payments, matching the "push only, no two-way
 * sync" scope already described to users in Settings → Integrations.
 */
import { logger } from "./logger";

export interface QuickBooksConfig {
  clientId?: string;
  clientSecret?: string;
  realmId?: string;
  accessToken?: string;
  refreshToken?: string;
  /** 'sandbox' | 'production' */
  environment?: string;
}

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function buildQuickBooksAuthorizeUrl(config: QuickBooksConfig, redirectUri: string, state: string): { url?: string; error?: string } {
  if (!config.clientId) return { error: "Missing QuickBooks Client ID — save your app credentials first" };
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return { url: `${QBO_AUTH_URL}?${params.toString()}` };
}

export async function exchangeQuickBooksCode(config: QuickBooksConfig, code: string, redirectUri: string): Promise<{ success: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
  if (!config.clientId || !config.clientSecret) return { success: false, error: "Missing Client ID/Secret" };
  try {
    const res = await fetch(QBO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `QuickBooks token exchange failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { access_token: string; refresh_token: string };
    return { success: true, accessToken: data.access_token, refreshToken: data.refresh_token };
  } catch (err) {
    logger.warn({ err }, "QuickBooks code exchange failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting QuickBooks" };
  }
}

function qboBaseUrl(environment?: string): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export async function testQuickBooksConnection(config: QuickBooksConfig): Promise<{ success: boolean; error?: string }> {
  if (!config.accessToken || !config.realmId) return { success: false, error: "Not connected — complete OAuth first" };
  try {
    const res = await fetch(`${qboBaseUrl(config.environment)}/v3/company/${config.realmId}/companyinfo/${config.realmId}`, {
      headers: { Authorization: `Bearer ${config.accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `QuickBooks error (${res.status}): ${body.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    logger.warn({ err }, "QuickBooks test connection failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting QuickBooks" };
  }
}

export async function pushInvoiceToQuickBooks(config: QuickBooksConfig, params: {
  customerName: string;
  invoiceNumber: string;
  total: number;
  lineItems: Array<{ description: string; amount: number }>;
}): Promise<{ success: boolean; qboId?: string; error?: string }> {
  if (!config.accessToken || !config.realmId) return { success: false, error: "Not connected — complete OAuth first" };
  try {
    const res = await fetch(`${qboBaseUrl(config.environment)}/v3/company/${config.realmId}/invoice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        DocNumber: params.invoiceNumber,
        CustomerRef: { name: params.customerName },
        Line: params.lineItems.map(li => ({
          Amount: li.amount,
          DetailType: "SalesItemLineDetail",
          Description: li.description,
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `QuickBooks error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { Invoice?: { Id: string } };
    return { success: true, qboId: data.Invoice?.Id };
  } catch (err) {
    logger.warn({ err }, "QuickBooks invoice push failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting QuickBooks" };
  }
}

// ─── Token Refresh ───────────────────────────────────────────────────────────

/** Use the refresh token to get a fresh access token. */
export async function refreshQuickBooksToken(
  config: QuickBooksConfig,
): Promise<{ success: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    return { success: false, error: "Missing clientId, clientSecret, or refreshToken" };
  }
  try {
    const res = await fetch(QBO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refreshToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Token refresh failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { access_token: string; refresh_token: string };
    return { success: true, accessToken: data.access_token, refreshToken: data.refresh_token };
  } catch (err) {
    logger.warn({ err }, "QuickBooks token refresh failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Internal QBO Request Helper ─────────────────────────────────────────────

async function qboFetch(
  config: QuickBooksConfig,
  method: "GET" | "POST",
  subpath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = qboBaseUrl(config.environment);
  const url = `${base}/v3/company/${config.realmId}/${subpath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// ─── Find or Create QBO Customer ─────────────────────────────────────────────

export async function findOrCreateQBOCustomer(
  config: QuickBooksConfig,
  displayName: string,
): Promise<{ success: boolean; qboCustomerId?: string; error?: string }> {
  if (!config.accessToken || !config.realmId) return { success: false, error: "Not connected" };
  try {
    // Escape single quotes for QBO QUERY syntax
    const safeName = displayName.replace(/'/g, "\\'");
    const { ok, data, status } = await qboFetch(
      config, "GET",
      `query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}'`)}&minorversion=65`,
    );
    if (!ok) return { success: false, error: `QBO query error (${status})` };
    const rows = (data as any)?.QueryResponse?.Customer as Array<{ Id: string }> | undefined;
    if (rows && rows.length > 0) return { success: true, qboCustomerId: rows[0].Id };

    // Not found — create
    const cr = await qboFetch(config, "POST", "customer?minorversion=65", { DisplayName: displayName });
    if (!cr.ok) return { success: false, error: `QBO create customer error (${cr.status})` };
    const id = (cr.data as any)?.Customer?.Id as string | undefined;
    if (!id) return { success: false, error: "QBO customer created but no Id returned" };
    return { success: true, qboCustomerId: id };
  } catch (err) {
    logger.warn({ err }, "QBO findOrCreateCustomer failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Find or Create QBO Invoice ──────────────────────────────────────────────

export async function findOrCreateQBOInvoice(
  config: QuickBooksConfig,
  params: {
    docNumber: string;
    qboCustomerId: string;
    total: number;
    lineItems: Array<{ description: string; amount: number }>;
    txnDate?: string;
  },
): Promise<{ success: boolean; qboInvoiceId?: string; error?: string }> {
  if (!config.accessToken || !config.realmId) return { success: false, error: "Not connected" };
  try {
    const safeDoc = params.docNumber.replace(/'/g, "\\'");
    const { ok, data, status } = await qboFetch(
      config, "GET",
      `query?query=${encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${safeDoc}'`)}&minorversion=65`,
    );
    if (!ok) return { success: false, error: `QBO query error (${status})` };
    const rows = (data as any)?.QueryResponse?.Invoice as Array<{ Id: string }> | undefined;
    if (rows && rows.length > 0) return { success: true, qboInvoiceId: rows[0].Id };

    // Not found — create
    const lines = params.lineItems.length > 0
      ? params.lineItems.map(li => ({
          Amount: li.amount,
          DetailType: "SalesItemLineDetail",
          Description: li.description,
          SalesItemLineDetail: { UnitPrice: li.amount, Qty: 1, ItemRef: { value: "1", name: "Services" } },
        }))
      : [{ Amount: params.total, DetailType: "SalesItemLineDetail", Description: "Service", SalesItemLineDetail: { UnitPrice: params.total, Qty: 1, ItemRef: { value: "1", name: "Services" } } }];

    const cr = await qboFetch(config, "POST", "invoice?minorversion=65", {
      DocNumber: params.docNumber,
      CustomerRef: { value: params.qboCustomerId },
      TxnDate: params.txnDate ?? new Date().toISOString().split("T")[0],
      Line: lines,
    });
    if (!cr.ok) return { success: false, error: `QBO create invoice error (${cr.status})` };
    const id = (cr.data as any)?.Invoice?.Id as string | undefined;
    if (!id) return { success: false, error: "QBO invoice created but no Id returned" };
    return { success: true, qboInvoiceId: id };
  } catch (err) {
    logger.warn({ err }, "QBO findOrCreateInvoice failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Record Payment in QBO ────────────────────────────────────────────────────

export async function recordPaymentInQBO(
  config: QuickBooksConfig,
  params: {
    qboCustomerId: string;
    qboInvoiceId: string;
    amount: number;
    paymentDate?: string;
  },
): Promise<{ success: boolean; qboPaymentId?: string; error?: string }> {
  if (!config.accessToken || !config.realmId) return { success: false, error: "Not connected" };
  try {
    const { ok, data, status } = await qboFetch(config, "POST", "payment?minorversion=65", {
      TotalAmt: params.amount,
      CustomerRef: { value: params.qboCustomerId },
      TxnDate: params.paymentDate ?? new Date().toISOString().split("T")[0],
      Line: [
        {
          Amount: params.amount,
          LinkedTxn: [{ TxnId: params.qboInvoiceId, TxnType: "Invoice" }],
        },
      ],
    });
    if (!ok) return { success: false, error: `QBO create payment error (${status}): ${JSON.stringify(data).slice(0, 200)}` };
    const id = (data as any)?.Payment?.Id as string | undefined;
    if (!id) return { success: false, error: "QBO payment created but no Id returned" };
    return { success: true, qboPaymentId: id };
  } catch (err) {
    logger.warn({ err }, "QBO recordPayment failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
