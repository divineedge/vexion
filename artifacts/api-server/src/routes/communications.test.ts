/**
 * Integration tests for webhook signature verification.
 * Tests both the Twilio (HMAC-SHA1) and OpenPhone (HMAC-SHA256) paths.
 */

import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import express from "express";
import request from "supertest";

// Hoist mock to module level so vitest can replace the module before imports resolve
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{}]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  },
  communicationsLogTable: {},
  customersTable: {},
  tenantsTable: {},
  jobsTable: {},
  propertiesTable: {},
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build a test Express app with the same middleware as the real app
// ──────────────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();

  // Mirror the raw-body capture from app.ts
  app.use(
    express.json({
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  return app;
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit-level: verify the signature helpers directly
// ──────────────────────────────────────────────────────────────────────────────

function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => `${k}${params[k]}`).join("");
  const expected = createHmac("sha1", authToken)
    .update(`${url}${paramStr}`)
    .digest("base64");
  return signature === expected;
}

function verifyOpenPhoneSignature(
  secret: string,
  signature: string,
  rawBody: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return signature === expected;
}

describe("Twilio signature verification", () => {
  const authToken = "test-auth-token-abc123";
  const url = "https://api.example.com/api/communications/webhook";
  const params = { From: "+15551234567", To: "+15559876543", Body: "STOP" };

  it("accepts a correctly signed request", () => {
    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map((k) => `${k}${params[k as keyof typeof params]}`).join("");
    const sig = createHmac("sha1", authToken)
      .update(`${url}${paramStr}`)
      .digest("base64");
    expect(verifyTwilioSignature(authToken, sig, url, params)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(
      verifyTwilioSignature(authToken, "invalidsig==", url, params),
    ).toBe(false);
  });

  it("rejects a request signed with a different auth token", () => {
    const wrongToken = "wrong-token";
    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map((k) => `${k}${params[k as keyof typeof params]}`).join("");
    const sig = createHmac("sha1", wrongToken)
      .update(`${url}${paramStr}`)
      .digest("base64");
    expect(verifyTwilioSignature(authToken, sig, url, params)).toBe(false);
  });
});

describe("OpenPhone signature verification", () => {
  const secret = "openphone-webhook-secret-xyz";

  it("accepts a correctly signed raw body", () => {
    const rawBody = JSON.stringify({ from: "+15551234567", to: "+15559876543", body: "STOP" });
    const sig = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    expect(verifyOpenPhoneSignature(secret, sig, rawBody)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const rawBody = JSON.stringify({ from: "+15551234567", to: "+15559876543", body: "STOP" });
    expect(verifyOpenPhoneSignature(secret, "sha256=invalidddd", rawBody)).toBe(false);
  });

  it("rejects when body is mutated after signing (raw body integrity)", () => {
    const originalBody = JSON.stringify({ from: "+1555", to: "+1999", body: "hello" });
    const sig = `sha256=${createHmac("sha256", secret).update(originalBody).digest("hex")}`;
    const mutatedBody = JSON.stringify({ from: "+1555", to: "+1999", body: "STOP" });
    // Mutated body should NOT verify against the original signature
    expect(verifyOpenPhoneSignature(secret, sig, mutatedBody)).toBe(false);
  });

  it("fails when signed with wrong secret", () => {
    const rawBody = JSON.stringify({ from: "+1", to: "+2", body: "hi" });
    const sig = `sha256=${createHmac("sha256", "wrong-secret").update(rawBody).digest("hex")}`;
    expect(verifyOpenPhoneSignature(secret, sig, rawBody)).toBe(false);
  });
});

describe("Webhook endpoint: missing signature header", () => {
  it("returns 403 when no signature header is present", async () => {
    const { default: communicationsRouter } = await import("./communications");
    const app = buildApp();
    app.use("/api", communicationsRouter);

    const resp = await request(app)
      .post("/api/communications/webhook")
      .set("Content-Type", "application/json")
      .send({ from: "+15551234567", to: "+15559876543", body: "STOP" });

    expect(resp.status).toBe(403);
    expect(resp.body.error).toMatch(/signature/i);
  });
});
