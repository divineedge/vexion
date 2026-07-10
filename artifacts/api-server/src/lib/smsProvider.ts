/**
 * SMS Provider Abstraction
 * Routes through OpenPhone, Grasshopper, or Twilio based on tenant config.
 * When no real provider is configured, logs to console (dev mode).
 */

import { logger } from "./logger";

export interface SmsProviderConfig {
  platform: "openphone" | "grasshopper" | "twilio" | null;
  config: Record<string, string>;
  fromNumber: string | null;
}

export interface SendSmsResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

async function sendViaOpenPhone(
  apiKey: string,
  from: string,
  to: string,
  body: string,
): Promise<SendSmsResult> {
  try {
    const resp = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, content: body }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `OpenPhone error ${resp.status}: ${err}` };
    }
    const data = await resp.json() as { data?: { id?: string } };
    return { success: true, externalId: data?.data?.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function sendViaTwilio(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
): Promise<SendSmsResult> {
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      },
    );
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Twilio error ${resp.status}: ${err}` };
    }
    const data = await resp.json() as { sid?: string };
    return { success: true, externalId: data?.sid };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function sendSms(
  providerConfig: SmsProviderConfig,
  to: string,
  body: string,
): Promise<SendSmsResult> {
  const { platform, config, fromNumber } = providerConfig;
  const from = fromNumber ?? "";

  if (!platform || !from) {
    // Dev / unconfigured — log to console
    logger.info({ to, body }, "[SMS DEV] Would send SMS");
    return { success: true, externalId: `dev-${Date.now()}` };
  }

  if (platform === "openphone") {
    const apiKey = config["apiKey"] ?? "";
    if (!apiKey) return { success: false, error: "OpenPhone API key not configured" };
    return sendViaOpenPhone(apiKey, from, to, body);
  }

  if (platform === "grasshopper") {
    // Grasshopper uses Twilio under the hood; they expose a Twilio-compatible API
    const accountSid = config["accountSid"] ?? "";
    const authToken = config["authToken"] ?? "";
    if (!accountSid || !authToken) return { success: false, error: "Grasshopper credentials not configured" };
    return sendViaTwilio(accountSid, authToken, from, to, body);
  }

  if (platform === "twilio") {
    const accountSid = config["accountSid"] ?? "";
    const authToken = config["authToken"] ?? "";
    if (!accountSid || !authToken) return { success: false, error: "Twilio credentials not configured" };
    return sendViaTwilio(accountSid, authToken, from, to, body);
  }

  return { success: false, error: `Unknown SMS platform: ${platform}` };
}
