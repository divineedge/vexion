/**
 * Tests for the Gmail OAuth connect/disconnect flow in settings.ts.
 *
 * Covers:
 *   1. authorize-url: requires admin role; rejects when Google client ID is missing.
 *   2. callback: rejects missing/expired/mismatched nonce; stores email + sets
 *      emailProvider="gmail" on a successful exchange.
 *   3. disconnect: clears Gmail fields and resets emailProvider to null only
 *      when it was "gmail" — leaves other providers untouched.
 *
 * All Google token/userinfo endpoints are mocked; no real OAuth calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories, so these variables are safe to
// reference inside factory closures.

const mocks = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSet = vi.fn();
  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });

  return { mockWhere, mockFrom, mockSet, mockUpdateWhere, mockUpdate };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mocks.mockFrom }),
    update: mocks.mockUpdate,
  },
  tenantsTable: {},
  usersTable: {},
}));

vi.mock("../lib/roles", () => ({
  isAdminRole: vi.fn(),
}));

vi.mock("../lib/gmailProvider", () => ({
  buildGoogleAuthorizeUrl: vi.fn(),
  exchangeGoogleCode: vi.fn(),
}));

// ObjectStorageService is instantiated at module level in settings.ts — stub it
// so the import doesn't throw (Gmail routes don't use it).
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {},
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { db } from "@workspace/db";
import { isAdminRole } from "../lib/roles";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode } from "../lib/gmailProvider";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

function tenantHeaders(tenantId = 1, userId = 1) {
  return { "x-tenant-id": String(tenantId), "x-user-id": String(userId) };
}

/** Queue the next db.select().from().where() to resolve with the given rows. */
function mockSelectReturning(rows: unknown[]) {
  mocks.mockWhere.mockResolvedValueOnce(rows);
}

function futureExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

function pastExpiry() {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

// ── authorize-url ─────────────────────────────────────────────────────────────

describe("GET /settings/email/gmail/oauth/authorize-url", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-wire chains that clearAllMocks() resets
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockSet.mockReturnValue({ where: mocks.mockUpdateWhere });
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mocks.mockFrom });

    app = buildApp();
    const { default: settingsRouter } = await import("./settings");
    app.use("/", settingsRouter);
  });

  it("returns 403 when the caller is not an admin", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await request(app)
      .get("/settings/email/gmail/oauth/authorize-url")
      .set(tenantHeaders());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it("returns 400 when GOOGLE_CLIENT_ID is missing", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockSelectReturning([{ emailProviderConfig: {} }]);
    (buildGoogleAuthorizeUrl as ReturnType<typeof vi.fn>).mockReturnValue({
      error: "Google OAuth is not configured on this server (missing GOOGLE_CLIENT_ID)",
    });

    const res = await request(app)
      .get("/settings/email/gmail/oauth/authorize-url")
      .set(tenantHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GOOGLE_CLIENT_ID/i);
  });

  it("returns 200 with a url when admin and Google is configured", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockSelectReturning([{ emailProviderConfig: {} }]);
    (buildGoogleAuthorizeUrl as ReturnType<typeof vi.fn>).mockReturnValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=1.abc",
    });

    const res = await request(app)
      .get("/settings/email/gmail/oauth/authorize-url")
      .set(tenantHeaders());

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("accounts.google.com");
  });
});

// ── callback ──────────────────────────────────────────────────────────────────

describe("GET /settings/email/gmail/oauth/callback", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockSet.mockReturnValue({ where: mocks.mockUpdateWhere });
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mocks.mockFrom });

    app = buildApp();
    const { default: settingsRouter } = await import("./settings");
    app.use("/", settingsRouter);
  });

  it("returns 400 when code is missing", async () => {
    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ state: "1.validnonce" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/missing|malformed/i);
  });

  it("returns 400 when state is missing", async () => {
    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "authcode123" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/missing|malformed/i);
  });

  it("returns 400 when no nonce is stored for the tenant (no pending OAuth flow)", async () => {
    mockSelectReturning([{ emailProviderConfig: {} }]);

    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "authcode123", state: "1.somerandomnonce" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired/i);
  });

  it("returns 400 when nonce is mismatched (CSRF protection)", async () => {
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailOAuthNonce: "correctnonce123",
          gmailOAuthNonceExpiresAt: futureExpiry(),
          gmailOAuthUserId: "1",
        },
      },
    ]);

    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "authcode123", state: "1.wrongnonce456" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired/i);
    // Must not proceed to token exchange
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("returns 400 when nonce is expired", async () => {
    const nonce = "expirednonce789";
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailOAuthNonce: nonce,
          gmailOAuthNonceExpiresAt: pastExpiry(),
          gmailOAuthUserId: "1",
        },
      },
    ]);

    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "authcode123", state: `1.${nonce}` });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired/i);
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("returns 400 and clears the nonce when the Google token exchange fails", async () => {
    const nonce = "validnonce000";
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailOAuthNonce: nonce,
          gmailOAuthNonceExpiresAt: futureExpiry(),
          gmailOAuthUserId: "1",
        },
      },
    ]);
    (exchangeGoogleCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Google token exchange failed (400): invalid_grant",
    });

    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "badcode", state: `1.${nonce}` });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/gmail connection failed/i);
    // A DB update (nonce clear) must have been issued
    expect(mocks.mockSet).toHaveBeenCalled();
  });

  it("stores refresh token + email and sets emailProvider='gmail' on success", async () => {
    const nonce = "validnonce111";
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailOAuthNonce: nonce,
          gmailOAuthNonceExpiresAt: futureExpiry(),
          gmailOAuthUserId: "1",
          fromAddress: "existing@example.com",
        },
      },
    ]);
    (exchangeGoogleCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      refreshToken: "rt-google-abc123",
      email: "owner@gmail.com",
    });

    const res = await request(app)
      .get("/settings/email/gmail/oauth/callback")
      .query({ code: "validcode", state: `1.${nonce}` });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/gmail connected successfully/i);

    // Find the db.update().set() call that stores the connection (emailProvider="gmail")
    const setCalls = (mocks.mockSet as ReturnType<typeof vi.fn>).mock.calls;
    const successCall = setCalls.find(
      ([arg]: [Record<string, unknown>]) =>
        arg && typeof arg === "object" && arg.emailProvider === "gmail",
    );
    expect(successCall).toBeDefined();
    const payload = successCall![0] as {
      emailProvider: string;
      emailProviderConfig: Record<string, string>;
    };
    expect(payload.emailProvider).toBe("gmail");
    expect(payload.emailProviderConfig.gmailRefreshToken).toBe("rt-google-abc123");
    expect(payload.emailProviderConfig.gmailEmail).toBe("owner@gmail.com");
    // Nonce keys must be stripped from the final persisted config
    expect(payload.emailProviderConfig.gmailOAuthNonce).toBeUndefined();
    expect(payload.emailProviderConfig.gmailOAuthNonceExpiresAt).toBeUndefined();
  });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe("DELETE /settings/email/gmail", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockSet.mockReturnValue({ where: mocks.mockUpdateWhere });
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mocks.mockFrom });

    app = buildApp();
    const { default: settingsRouter } = await import("./settings");
    app.use("/", settingsRouter);
  });

  it("returns 403 when the caller is not an admin", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await request(app)
      .delete("/settings/email/gmail")
      .set(tenantHeaders());

    expect(res.status).toBe(403);
  });

  it("clears gmail fields and sets emailProvider=null when Gmail was the active provider", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailRefreshToken: "rt-abc",
          gmailEmail: "owner@gmail.com",
          fromAddress: "owner@gmail.com",
        },
        emailProvider: "gmail",
      },
    ]);

    const res = await request(app)
      .delete("/settings/email/gmail")
      .set(tenantHeaders());

    expect(res.status).toBe(204);

    const setCalls = (mocks.mockSet as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const payload = setCalls[0][0] as {
      emailProvider: string | null;
      emailProviderConfig: Record<string, string>;
    };
    expect(payload.emailProvider).toBeNull();
    expect(payload.emailProviderConfig.gmailRefreshToken).toBeUndefined();
    expect(payload.emailProviderConfig.gmailEmail).toBeUndefined();
    // Unrelated fields must survive
    expect(payload.emailProviderConfig.fromAddress).toBe("owner@gmail.com");
  });

  it("keeps the existing emailProvider when Gmail was not the active provider", async () => {
    (isAdminRole as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockSelectReturning([
      {
        emailProviderConfig: {
          gmailRefreshToken: "rt-old",
          gmailEmail: "old@gmail.com",
          apiKey: "sg-key",
        },
        emailProvider: "sendgrid",
      },
    ]);

    const res = await request(app)
      .delete("/settings/email/gmail")
      .set(tenantHeaders());

    expect(res.status).toBe(204);

    const setCalls = (mocks.mockSet as ReturnType<typeof vi.fn>).mock.calls;
    const payload = setCalls[0][0] as {
      emailProvider: string | null;
      emailProviderConfig: Record<string, string>;
    };
    // Non-Gmail provider must be preserved
    expect(payload.emailProvider).toBe("sendgrid");
    // Gmail tokens cleared
    expect(payload.emailProviderConfig.gmailRefreshToken).toBeUndefined();
    expect(payload.emailProviderConfig.gmailEmail).toBeUndefined();
    // SendGrid key survives
    expect(payload.emailProviderConfig.apiKey).toBe("sg-key");
  });
});
