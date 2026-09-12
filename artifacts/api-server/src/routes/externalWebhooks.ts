import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { decryptSecretConfig } from "../lib/secretsCrypto";
import { accountAuthenticatedWebhookRequest, authorizeWebhookConnection, ingestExternalCommunication, appendExternalAudit, providerEventIdempotencyKey, validateVoipEvent } from "../lib/externalAccess";
import { getRingCentralValidationToken, normalizeVoipEvent, verifyQuoWebhook } from "../lib/externalVoipAdapters";

const router: IRouter = Router();

function paramsId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function headers(req: Request): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}
function sameHash(value: string, hash: string): boolean {
  const actual = createHash("sha256").update(value).digest();
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

router.post("/external/webhooks/:id/:provider", async (req, res): Promise<void> => {
  const provider = paramsId(req.params.provider);
  const id = paramsId(req.params.id);
  if (provider !== "quo" && provider !== "ringcentral") { res.status(404).json({ error: "Unsupported webhook provider" }); return; }
  const auth = await authorizeWebhookConnection(id, provider, req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const providerHeaders = headers(req);
  if (provider === "ringcentral") {
    const validationToken = getRingCentralValidationToken(providerHeaders);
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    const emptyChallenge = Boolean(validationToken) && (!rawBody || rawBody.length === 0) &&
      (req.body == null || (typeof req.body === "object" && !Array.isArray(req.body) && Object.keys(req.body as Record<string, unknown>).length === 0));
    // The configured validation token is required for both setup and normal
    // deliveries. Never reflect an arbitrary challenge header.
    // Keep the complete challenge response well under RingCentral's 1024-byte
    // response limit (including headers); valid issued tokens are short.
    if (typeof validationToken !== "string" || validationToken.length > 512 || !sameHash(validationToken, auth.context.tokenHash)) {
      await appendExternalAudit(auth.context, "communications:webhook", "webhook", "denied", typeof req.id === "string" ? req.id : undefined);
      res.status(401).json({ error: "Webhook authentication failed" });
      return;
    }
    const accounted = await accountAuthenticatedWebhookRequest(auth.context, req);
    if (!accounted.ok) { res.status(accounted.status).json({ error: accounted.error }); return; }
    if (emptyChallenge && validationToken) {
      // RingCentral uses Validation-Token for setup. The challenge is only an
      // empty-body delivery; ordinary events carry the same header and must
      // continue through the exact token check and ingestion path below.
      res.setHeader("Validation-Token", validationToken);
      await appendExternalAudit(auth.context, "communications:webhook_handshake", "webhook", "allowed", typeof req.id === "string" ? req.id : undefined);
      res.type("application/json").status(200).end();
      return;
    }
  } else {
    const secret = decryptSecretConfig(auth.context.webhookSecretEncrypted).signingSecret;
    if (typeof secret !== "string" || !verifyQuoWebhook((req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0), providerHeaders, secret)) {
      await appendExternalAudit(auth.context, "communications:webhook", "webhook", "denied", typeof req.id === "string" ? req.id : undefined);
      res.status(401).json({ error: "Webhook authentication failed" });
      return;
    }
    const accounted = await accountAuthenticatedWebhookRequest(auth.context, req);
    if (!accounted.ok) { res.status(accounted.status).json({ error: accounted.error }); return; }
  }
  let normalized;
  try {
    normalized = normalizeVoipEvent(provider, req.body);
  } catch {
    await appendExternalAudit(auth.context, "communications:webhook", "webhook", "denied", typeof req.id === "string" ? req.id : undefined);
    res.status(400).json({ error: "Invalid webhook event" });
    return;
  }
  let imported = 0;
  for (const candidate of normalized) {
    const event = validateVoipEvent(candidate);
    if (!event) { await appendExternalAudit(auth.context, "communications:webhook", "webhook", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid webhook event" }); return; }
    const result = await ingestExternalCommunication(auth.context, provider, event, providerEventIdempotencyKey(provider, event.eventId));
    if (result.kind === "conflict" || result.kind === "invalid") { await appendExternalAudit(auth.context, "communications:webhook", "webhook", "denied", typeof req.id === "string" ? req.id : undefined); res.status(409).json({ error: "Webhook event conflict" }); return; }
    if ("message" in result && result.kind === "created") imported += 1;
  }
  await appendExternalAudit(auth.context, "communications:webhook", "webhook", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.status(200).json({ imported });
});

export default router;