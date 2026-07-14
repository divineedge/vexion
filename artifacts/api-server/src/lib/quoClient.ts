/**
 * Quo (quo.com, formerly OpenPhone) API client.
 * Auth: `Authorization: <apiKey>` header (not Bearer). Base URL: https://api.quo.com.
 * Docs: https://www.quo.com/docs
 */

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "./logger";

const QUO_API_BASE = "https://api.quo.com";

export interface QuoCallParticipant {
  phoneNumber?: string;
}

export interface QuoCallRecord {
  id: string;
  direction?: string; // "incoming" | "outgoing"
  status?: string; // "completed" | "missed" | "busy" | "no-answer" | "voicemail"
  participants?: string[];
  duration?: number;
  voicemail?: { url?: string } | null;
  createdAt?: string;
}

/**
 * List recent calls for a Quo phone number. `participants` narrows to calls
 * with a specific counterparty; Quo currently limits this to 1:1 conversations.
 */
export async function listQuoCalls(
  apiKey: string,
  phoneNumberId: string,
  opts: { participants?: string[]; maxResults?: number } = {},
): Promise<{ success: true; calls: QuoCallRecord[] } | { success: false; error: string }> {
  try {
    const params = new URLSearchParams({ phoneNumberId });
    if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
    for (const p of opts.participants ?? []) params.append("participants[]", p);

    const resp = await fetch(`${QUO_API_BASE}/v1/calls?${params.toString()}`, {
      headers: { Authorization: apiKey },
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Quo error ${resp.status}: ${err}` };
    }

    const data = (await resp.json()) as { data?: QuoCallRecord[] };
    return { success: true, calls: data.data ?? [] };
  } catch (e) {
    logger.error({ err: e }, "Quo listCalls failed");
    return { success: false, error: String(e) };
  }
}

export async function getQuoCallById(
  apiKey: string,
  callId: string,
): Promise<{ success: true; call: QuoCallRecord } | { success: false; error: string }> {
  try {
    const resp = await fetch(`${QUO_API_BASE}/v1/calls/${encodeURIComponent(callId)}`, {
      headers: { Authorization: apiKey },
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Quo error ${resp.status}: ${err}` };
    }
    const data = (await resp.json()) as { data?: QuoCallRecord };
    if (!data.data) return { success: false, error: "Call not found" };
    return { success: true, call: data.data };
  } catch (e) {
    logger.error({ err: e }, "Quo getCallById failed");
    return { success: false, error: String(e) };
  }
}

/**
 * Verify a Quo webhook signature (svix-compatible scheme).
 * HMAC-SHA256 over `${webhookId}.${webhookTimestamp}.${rawBody}`, using the
 * base64-decoded key bytes from the `whsec_...` secret. Rejects deliveries
 * whose timestamp is more than 5 minutes old to defeat replay attacks.
 */
export function verifyQuoSignature(
  whsecKey: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignatureHeader: string,
  rawBody: string,
): boolean {
  try {
    const timestamp = Number(webhookTimestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60) return false;

    const keyB64 = whsecKey.startsWith("whsec_") ? whsecKey.slice("whsec_".length) : whsecKey;
    const secretBytes = Buffer.from(keyB64, "base64");

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");

    const provided = webhookSignatureHeader
      .split(" ")
      .map(s => s.trim())
      .filter(Boolean)
      .map(entry => entry.split(",")[1])
      .filter(Boolean);

    const expBuf = Buffer.from(expected, "base64");
    return provided.some(sig => {
      try {
        const sigBuf = Buffer.from(sig, "base64");
        if (sigBuf.length !== expBuf.length) return false;
        return timingSafeEqual(sigBuf, expBuf);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
