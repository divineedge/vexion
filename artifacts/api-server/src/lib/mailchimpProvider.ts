/**
 * Mailchimp provider — pushes customer/tag data as list members so marketing
 * automations in Mailchimp can react to signups, tag changes, and campaign
 * acquisition. One-way (this app -> Mailchimp), mirroring the QuickBooks push model.
 */
import crypto from "node:crypto";
import { logger } from "./logger";

export interface MailchimpConfig {
  apiKey?: string;
  audienceId?: string;
}

export interface MailchimpResult {
  success: boolean;
  error?: string;
}

/** Mailchimp API keys are suffixed with the data center, e.g. "abc123-us21" */
function dataCenterFromKey(apiKey: string): string | null {
  const parts = apiKey.split("-");
  return parts.length === 2 ? parts[1] : null;
}

export async function testMailchimpConnection(config: MailchimpConfig): Promise<MailchimpResult> {
  if (!config.apiKey || !config.audienceId) return { success: false, error: "Missing API key or audience (list) ID" };
  const dc = dataCenterFromKey(config.apiKey);
  if (!dc) return { success: false, error: "API key is missing its data-center suffix (expected format: key-usXX)" };

  try {
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${config.audienceId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`anystring:${config.apiKey}`).toString("base64")}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Mailchimp error (${res.status}): ${body.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    logger.warn({ err }, "Mailchimp test connection failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Mailchimp" };
  }
}

export async function upsertMailchimpMember(config: MailchimpConfig, params: {
  email: string;
  tags?: string[];
  mergeFields?: Record<string, string>;
}): Promise<MailchimpResult> {
  if (!config.apiKey || !config.audienceId) return { success: false, error: "Mailchimp not configured" };
  const dc = dataCenterFromKey(config.apiKey);
  if (!dc) return { success: false, error: "Invalid Mailchimp API key" };

  const subscriberHash = crypto.createHash("md5").update(params.email.toLowerCase()).digest("hex");

  try {
    const res = await fetch(
      `https://${dc}.api.mailchimp.com/3.0/lists/${config.audienceId}/members/${subscriberHash}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Basic ${Buffer.from(`anystring:${config.apiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: params.email,
          status_if_new: "subscribed",
          merge_fields: params.mergeFields ?? {},
          tags: params.tags ?? [],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Mailchimp error (${res.status}): ${body.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    logger.warn({ err }, "Mailchimp member upsert failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Mailchimp" };
  }
}
