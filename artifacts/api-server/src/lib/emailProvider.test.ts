/**
 * Tests for the email provider abstraction.
 * Verifies:
 *   1. Missing SMTP host returns a predictable failure (no silent success)
 *   2. Configured SMTP host attempts a real transport (fails at network, not at config)
 *   3. Dev mode (no provider) logs and returns success
 *   4. Unknown provider returns a clear error
 */

import { describe, it, expect } from "vitest";
import { sendEmail } from "./emailProvider";

describe("sendEmail — SMTP path", () => {
  it("returns failure when smtpHost is not set", async () => {
    const result = await sendEmail(
      { provider: "smtp", config: {}, fromAddress: "from@test.com" },
      "to@example.com",
      "Test subject",
      "Test body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/host not configured/i);
  });

  it("reads smtpHost/smtpPort/smtpUser/smtpPass from config (not host/port/user/pass)", async () => {
    // A real TCP connection will fail since 'localhost:9999' isn't running,
    // but the error must come from the transport layer, not from a missing-config guard.
    const result = await sendEmail(
      {
        provider: "smtp",
        config: {
          smtpHost: "localhost",
          smtpPort: "9999",
          smtpUser: "user",
          smtpPass: "pass",
        },
        fromAddress: "from@test.com",
      },
      "to@example.com",
      "Test subject",
      "Test body"
    );
    // Should fail at the network level, not at the config check
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SMTP error/i);
    // Must NOT be the config-missing error
    expect(result.error).not.toMatch(/host not configured/i);
  });

  it("backwards-compatible: falls back to unprefixed host key", async () => {
    const result = await sendEmail(
      {
        provider: "smtp",
        config: { host: "localhost", port: "9998" },
        fromAddress: "from@test.com",
      },
      "to@example.com",
      "Test subject",
      "Test body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SMTP error/i);
    expect(result.error).not.toMatch(/host not configured/i);
  });
});

describe("sendEmail — dev mode", () => {
  it("returns success with dev externalId when provider is null", async () => {
    const result = await sendEmail(
      { provider: null, config: {}, fromAddress: null },
      "to@example.com",
      "Subject",
      "Body"
    );
    expect(result.success).toBe(true);
    expect(result.externalId).toMatch(/^dev-/);
  });
});

describe("sendEmail — unknown provider", () => {
  it("returns a clear error for unknown provider string", async () => {
    const result = await sendEmail(
      { provider: "unknown" as never, config: {}, fromAddress: null },
      "to@example.com",
      "Subject",
      "Body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown/i);
  });
});

describe("sendEmail — Resend/SendGrid/Mailgun", () => {
  it("returns failure when SendGrid API key is missing", async () => {
    const result = await sendEmail(
      { provider: "sendgrid", config: {}, fromAddress: null },
      "to@example.com",
      "Subject",
      "Body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/api key/i);
  });

  it("returns failure when Resend API key is missing", async () => {
    const result = await sendEmail(
      { provider: "resend", config: {}, fromAddress: null },
      "to@example.com",
      "Subject",
      "Body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/api key/i);
  });

  it("returns failure when Mailgun API key or domain is missing", async () => {
    const result = await sendEmail(
      { provider: "mailgun", config: { apiKey: "key" }, fromAddress: null },
      "to@example.com",
      "Subject",
      "Body"
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/domain/i);
  });
});
