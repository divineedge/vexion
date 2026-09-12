import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeWebhookConnection: vi.fn(),
  accountAuthenticatedWebhookRequest: vi.fn(),
  ingestExternalCommunication: vi.fn(),
  appendExternalAudit: vi.fn(),
  normalizeVoipEvent: vi.fn(),
}));

vi.mock("../lib/externalAccess", () => ({
  authorizeWebhookConnection: mocks.authorizeWebhookConnection,
  accountAuthenticatedWebhookRequest: mocks.accountAuthenticatedWebhookRequest,
  ingestExternalCommunication: mocks.ingestExternalCommunication,
  appendExternalAudit: mocks.appendExternalAudit,
  validateVoipEvent: (value: unknown) => value,
  providerEventIdempotencyKey: (_provider: string, eventId: string) => `provider:test:${eventId}`,
}));
vi.mock("../lib/externalVoipAdapters", () => ({
  getRingCentralValidationToken: (headers: Record<string, string | undefined>) => headers["validation-token"] ?? null,
  normalizeVoipEvent: mocks.normalizeVoipEvent,
  verifyQuoWebhook: vi.fn(),
}));

import externalWebhooksRouter from "./externalWebhooks";

const connection = {
  id: "f5683ebc-3b1f-4cfb-b9d2-471cbddcd338", tenantId: 7, createdByUserId: 9, name: "RingCentral",
  mode: "webhook" as const, provider: "ringcentral" as const, scopes: ["communications:ingest"] as const,
  allowWrites: true, tokenHash: crypto.createHash("sha256").update("configured-token").digest("hex"), webhookSecretEncrypted: null,
};

function app() {
  const server = express();
  server.use(express.json({ verify: (req: express.Request & { rawBody?: Buffer }, _res, body) => { req.rawBody = body; } }));
  server.use(externalWebhooksRouter);
  return server;
}

describe("RingCentral external webhook authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeWebhookConnection.mockResolvedValue({ ok: true, context: connection });
    mocks.accountAuthenticatedWebhookRequest.mockResolvedValue({ ok: true });
    mocks.ingestExternalCommunication.mockResolvedValue({ kind: "created", message: { id: 44 } });
    mocks.normalizeVoipEvent.mockReturnValue([{
      eventId: "rc-1", type: "sms", direction: "inbound", from: "+15550001", to: "+15550002",
      occurredAt: "2025-01-01T00:00:00.000Z", status: "Received",
    }]);
  });

  it("echoes Validation-Token only for an empty setup challenge and never normalizes it", async () => {
    const response = await request(app()).post(`/external/webhooks/${connection.id}/ringcentral`)
      .set("Validation-Token", "configured-token");
    expect(response.status).toBe(200);
    expect(response.headers["validation-token"]).toBe("configured-token");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(mocks.normalizeVoipEvent).not.toHaveBeenCalled();
    expect(mocks.ingestExternalCommunication).not.toHaveBeenCalled();
  });

  it("authenticates a non-empty official delivery with Validation-Token and imports it", async () => {
    const response = await request(app()).post(`/external/webhooks/${connection.id}/ringcentral`)
      .set("Validation-Token", "configured-token").send({ event: "/restapi/v1.0/account/~/extension/~/message-store/instant", body: {} });
    expect(response.status).toBe(200);
    expect(mocks.normalizeVoipEvent).toHaveBeenCalledOnce();
    expect(mocks.ingestExternalCommunication).toHaveBeenCalledOnce();
  });

  it("rejects a non-empty delivery whose Validation-Token does not match the stored token hash", async () => {
    const response = await request(app()).post(`/external/webhooks/${connection.id}/ringcentral`)
      .set("Validation-Token", "wrong-token").send({ event: "/restapi/v1.0/account/~/extension/~/message-store/instant", body: {} });
    expect(response.status).toBe(401);
    expect(mocks.normalizeVoipEvent).not.toHaveBeenCalled();
    expect(mocks.accountAuthenticatedWebhookRequest).not.toHaveBeenCalled();
  });

  it("never reflects a bad empty-body setup token or consumes quota before authentication", async () => {
    const response = await request(app()).post(`/external/webhooks/${connection.id}/ringcentral`)
      .set("Validation-Token", "bad-challenge-token");
    expect(response.status).toBe(401);
    expect(response.headers["validation-token"]).toBeUndefined();
    expect(mocks.accountAuthenticatedWebhookRequest).not.toHaveBeenCalled();
  });
});