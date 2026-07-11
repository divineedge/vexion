/**
 * Lob Print & Mail provider — sends a physical letter (e.g. a paper invoice)
 * to a customer's mailing address.
 */
import { logger } from "./logger";

export interface LobConfig {
  apiKey?: string;
}

export interface LobTestResult {
  success: boolean;
  error?: string;
}

export interface LobLetterResult {
  success: boolean;
  letterId?: string;
  status?: string;
  error?: string;
}

export async function testLobConnection(config: LobConfig): Promise<LobTestResult> {
  if (!config.apiKey) return { success: false, error: "Missing API key" };
  try {
    const res = await fetch("https://api.lob.com/v1/letters?limit=1", {
      headers: { Authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Lob error (${res.status}): ${body.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    logger.warn({ err }, "Lob test connection failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Lob" };
  }
}

export async function sendLobLetter(config: LobConfig, params: {
  to: { name: string; address_line1: string; address_city: string; address_state: string; address_zip: string };
  from: { name: string; address_line1: string; address_city: string; address_state: string; address_zip: string };
  html: string;
  description: string;
}): Promise<LobLetterResult> {
  if (!config.apiKey) return { success: false, error: "Lob not configured" };
  try {
    const res = await fetch("https://api.lob.com/v1/letters", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: params.description,
        to: params.to,
        from: params.from,
        file: params.html,
        color: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Lob error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { id: string; expected_delivery_date?: string };
    return { success: true, letterId: data.id, status: "requested" };
  } catch (err) {
    logger.warn({ err }, "Lob letter send failed");
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Lob" };
  }
}
