/**
 * QuickBooks Online provider — OAuth2 authorization-code flow plus a one-way
 * push of invoices/customers, matching the "push only, no two-way sync" scope
 * already described to users in Settings → Integrations.
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
