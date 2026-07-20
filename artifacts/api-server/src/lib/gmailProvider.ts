/**
 * Gmail email provider — lets a tenant connect their own Google account (OAuth2,
 * authorization-code flow) instead of hand-entering SMTP/API-key credentials, then
 * sends transactional mail through the Gmail API as that account. Send-only: this
 * never reads/lists the connected mailbox.
 *
 * Uses a single app-wide Google OAuth client (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
 * env vars), unlike QuickBooks where each tenant registers their own OAuth app — Gmail
 * is meant to be a one-click "sign in with Google", not a developer credential form.
 */
import { logger } from "./logger";
import type { SendEmailResult } from "./emailProvider";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// Send-only scope, plus the minimal identity scope needed to know which address to send from.
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email";

function getGoogleClientCreds(): { clientId?: string; clientSecret?: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export function buildGoogleAuthorizeUrl(redirectUri: string, state: string): { url?: string; error?: string } {
  const { clientId } = getGoogleClientCreds();
  if (!clientId) return { error: "Google OAuth is not configured on this server (missing GOOGLE_CLIENT_ID)" };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    // Force the consent screen every time so Google always issues a refresh_token —
    // without this, a user who previously granted access gets no refresh_token back
    // on a second connect, silently breaking reconnection after a disconnect.
    prompt: "consent",
    state,
  });
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ success: boolean; refreshToken?: string; email?: string; error?: string }> {
  const { clientId, clientSecret } = getGoogleClientCreds();
  if (!clientId || !clientSecret) return { success: false, error: "Google OAuth is not configured on this server" };

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return { success: false, error: `Google token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}` };
    }
    const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string };
    if (!tokenData.refresh_token) {
      // Happens if the user has already granted consent and Google skipped re-issuing one.
      // We always request prompt=consent to avoid this, but guard anyway since without a
      // refresh token we cannot send mail beyond the current access token's ~1hr lifetime.
      return { success: false, error: "Google did not return a refresh token — disconnect any prior grant for this app in your Google Account and try again" };
    }

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return { success: false, error: `Could not fetch connected Google account email (${userRes.status})` };
    }
    const userData = await userRes.json() as { email?: string };

    return { success: true, refreshToken: tokenData.refresh_token, email: userData.email };
  } catch (err) {
    logger.warn({ err }, "Google OAuth code exchange failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Google" };
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken?: string; error?: string }> {
  const { clientId, clientSecret } = getGoogleClientCreds();
  if (!clientId || !clientSecret) return { error: "Google OAuth is not configured on this server" };

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `Google access token refresh failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { access_token: string };
    return { accessToken: data.access_token };
  } catch (err) {
    logger.warn({ err }, "Google access token refresh failed");
    return { error: err instanceof Error ? err.message : "Network error contacting Google" };
  }
}

/** Minimal RFC 2822 message builder — plain text only, matching the rest of the email abstraction. */
function buildRawMessage(from: string, to: string, subject: string, body: string, displayName?: string): string {
  // Format as "Display Name <address>" when a friendly name is provided.
  // RFC 5321: if the display name contains special characters or spaces, wrap it in quotes.
  const fromHeader = displayName
    ? `"${displayName.replace(/"/g, '\\"')}" <${from}>`
    : from;
  const message = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendViaGmail(
  refreshToken: string,
  fromEmail: string,
  to: string,
  subject: string,
  body: string,
  displayName?: string,
): Promise<SendEmailResult> {
  if (!refreshToken) return { success: false, error: "Gmail is not connected — connect a Google account in Settings" };

  const { accessToken, error: refreshError } = await refreshAccessToken(refreshToken);
  if (!accessToken) return { success: false, error: refreshError ?? "Could not obtain a Gmail access token" };

  try {
    // Gmail always sends "From" as the authenticated account regardless of the header value
    // unless the address is a verified send-as alias, so we always pass the connected account's
    // own address rather than any tenant-configured "from" override.
    // The display name (e.g. "Mike's Lawn Care") is accepted by Gmail and shown to recipients.
    const raw = buildRawMessage(fromEmail, to, subject, body, displayName);
    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { success: false, error: `Gmail API error (${res.status}): ${errBody.slice(0, 200)}` };
    }
    const data = await res.json() as { id?: string };
    return { success: true, externalId: data.id };
  } catch (err) {
    return { success: false, error: `Gmail error: ${String(err)}` };
  }
}
