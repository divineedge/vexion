/**
 * Integration tests for webhook signature verification AND call event handling.
 *
 * Covers:
 *   - Twilio/OpenPhone signature helpers (unit)
 *   - 403 on missing signature header
 *   - Twilio "no-answer"   → followup_queue_items triggerType: "missed_call"
 *   - Twilio RecordingUrl  → followup_queue_items triggerType: "voicemail"
 *   - OpenPhone call.completed status:missed → triggerType: "missed_call"
 *   - OpenPhone call.recording.completed    → triggerType: "voicemail"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { db, followupQueueItemsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vitest before any imports resolve)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  },
  communicationsLogTable: { _t: "comm_log" },
  customersTable:          { _t: "customers" },
  tenantsTable:            { _t: "tenants" },
  jobsTable:               { _t: "jobs" },
  propertiesTable:         { _t: "properties" },
  followupQueueItemsTable: { _t: "followup_queue_items" },
  internalTasksTable:      { _t: "internal_tasks" },
}));

vi.mock("../lib/quoClient", () => ({
  listQuoCalls:       vi.fn().mockResolvedValue([]),
  getQuoCallById:     vi.fn().mockResolvedValue(null),
  verifyQuoSignature: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express app that mirrors the real server's body-parsing. */
function buildApp() {
  const app = express();
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

/**
 * Configure db.select to return sequential result sets, one per call.
 * Each entry in `results` is the array that one `await db.select()…` will resolve to.
 */
function setupSelectSequence(results: Array<Array<unknown>>) {
  let idx = 0;
  vi.mocked(db).select.mockImplementation(() => {
    const result = results[idx++] ?? [];
    const whereImpl = () => {
      // Make the returned object both a Promise (for `await db.select().from().where()`)
      // and chainable with `.limit()` (for `await db.select().from().where().limit(1)`).
      const p = Promise.resolve(result) as Promise<unknown[]> & {
        limit: (n: number) => Promise<unknown[]>;
        orderBy: (...args: unknown[]) => Promise<unknown[]>;
      };
      p.limit   = vi.fn().mockResolvedValue(result) as unknown as typeof p.limit;
      p.orderBy = vi.fn().mockResolvedValue(result) as unknown as typeof p.orderBy;
      return p;
    };
    return {
      from: vi.fn().mockReturnValue({
        where:   vi.fn().mockImplementation(whereImpl),
        orderBy: vi.fn().mockResolvedValue(result),
      }),
    } as unknown as ReturnType<typeof db.select>;
  });
}

/**
 * Configure db.insert to capture every insert call.
 * Returns the captured array so tests can assert on it.
 */
function captureInserts() {
  const captured: Array<{ table: unknown; values: unknown }> = [];
  vi.mocked(db).insert.mockImplementation((table: unknown) => {
    const valuesFn = vi.fn().mockImplementation((vals: unknown) => {
      captured.push({ table, values: vals });
      // Support both `await .values(...)` and `await .values(...).returning()`
      const p = Promise.resolve([{ id: 999 }]) as unknown as Promise<{ id: number }[]> & {
        returning: () => Promise<{ id: number }[]>;
      };
      p.returning = vi.fn().mockResolvedValue([{ id: 999 }]) as unknown as typeof p.returning;
      return p;
    });
    return { values: valuesFn } as unknown as ReturnType<typeof db.insert>;
  });
  return captured;
}

/** Compute a Twilio HMAC-SHA1 signature over url + sorted form params. */
function twilioSig(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(k => `${k}${params[k]}`).join("");
  return createHmac("sha1", authToken).update(`${url}${paramStr}`).digest("base64");
}

/** Compute an OpenPhone HMAC-SHA256 signature over the raw JSON body. */
function openPhoneSig(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

// Fixtures shared across call-event tests
const AUTH_TOKEN    = "twilio-test-auth-token-abc";
const OP_SECRET     = "openphone-test-webhook-secret-xyz";
const CALLER        = "+15551234567";
const COMPANY_LINE  = "+15559876543";

// The URL Express sees in supertest: protocol=http, hostname=127.0.0.1 (port stripped)
const WEBHOOK_URL = "http://127.0.0.1/api/communications/webhook";

const MOCK_TENANT = {
  id: 1,
  mainPhoneNumber:     COMPANY_LINE,
  marketingPhoneNumber: null,
  phonePlatform:       "twilio",
  phonePlatformConfig: { authToken: AUTH_TOKEN, webhookSecret: OP_SECRET },
  followupTriggerConfig: null,
};

const MOCK_CUSTOMER = {
  id: 42,
  name:          "Jane Smith",
  phone:         CALLER,
  secondaryPhone: null,
  tenantId:      1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Unit-level: signature helpers
// ─────────────────────────────────────────────────────────────────────────────

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
    expect(verifyOpenPhoneSignature(secret, sig, mutatedBody)).toBe(false);
  });

  it("fails when signed with wrong secret", () => {
    const rawBody = JSON.stringify({ from: "+1", to: "+2", body: "hi" });
    const sig = `sha256=${createHmac("sha256", "wrong-secret").update(rawBody).digest("hex")}`;
    expect(verifyOpenPhoneSignature(secret, sig, rawBody)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook endpoint: guard checks
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook endpoint: missing signature header", () => {
  beforeEach(() => {
    // db.select returns empty by default (no tenant found)
    setupSelectSequence([[], []]);
  });

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

// ─────────────────────────────────────────────────────────────────────────────
// Call event handling — followup queue creation
// ─────────────────────────────────────────────────────────────────────────────

describe("Twilio missed-call and voicemail webhook handling", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: communicationsRouter } = await import("./communications");
    app = buildApp();
    app.use("/api", communicationsRouter);
  });

  it("creates a missed_call followup when Twilio reports no-answer", async () => {
    const params = {
      CallStatus: "no-answer",
      From:       CALLER,
      To:         COMPANY_LINE,
    };
    const sig = twilioSig(AUTH_TOKEN, WEBHOOK_URL, params);

    // Sequence: (1) tenant lookup for sig verification, (2) tenant lookup for
    // call processing, (3) customer lookup by caller number.
    setupSelectSequence([[MOCK_TENANT], [MOCK_TENANT], [MOCK_CUSTOMER]]);
    const inserts = captureInserts();

    const resp = await request(app)
      .post("/api/communications/webhook")
      .type("form")
      .set("x-twilio-signature", sig)
      .send(params);

    expect(resp.status).toBe(200);

    // Should have inserted a comm log row and a followup row
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    const followup = inserts.find(
      (c) => c.table === followupQueueItemsTable,
    );
    expect(followup).toBeDefined();
    expect(followup?.values).toMatchObject({
      triggerType: "missed_call",
      customerId:  MOCK_CUSTOMER.id,
      status:      "open",
    });
  });

  it("creates a voicemail followup when Twilio includes a RecordingUrl", async () => {
    const params = {
      CallStatus:   "completed",
      RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE123",
      From:         CALLER,
      To:           COMPANY_LINE,
    };
    const sig = twilioSig(AUTH_TOKEN, WEBHOOK_URL, params);

    setupSelectSequence([[MOCK_TENANT], [MOCK_TENANT], [MOCK_CUSTOMER]]);
    const inserts = captureInserts();

    const resp = await request(app)
      .post("/api/communications/webhook")
      .type("form")
      .set("x-twilio-signature", sig)
      .send(params);

    expect(resp.status).toBe(200);

    const followup = inserts.find(
      (c) => c.table === followupQueueItemsTable,
    );
    expect(followup).toBeDefined();
    expect(followup?.values).toMatchObject({
      triggerType: "voicemail",
      customerId:  MOCK_CUSTOMER.id,
      status:      "open",
    });
  });
});

describe("OpenPhone / Quo missed-call and voicemail webhook handling", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: communicationsRouter } = await import("./communications");
    app = buildApp();
    app.use("/api", communicationsRouter);
  });

  it("creates a missed_call followup for call.completed with status:missed", async () => {
    const payload = {
      type: "call.completed",
      data: {
        object: {
          status: "missed",
          from:   CALLER,
          to:     [{ phoneNumber: COMPANY_LINE }],
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = openPhoneSig(OP_SECRET, rawBody);

    // Sequence: (1) tenant lookup for sig verification (uses to[0].phoneNumber),
    // (2) tenant lookup for call processing, (3) customer lookup.
    setupSelectSequence([[MOCK_TENANT], [MOCK_TENANT], [MOCK_CUSTOMER]]);
    const inserts = captureInserts();

    const resp = await request(app)
      .post("/api/communications/webhook")
      .set("Content-Type", "application/json")
      .set("x-openphone-signature", sig)
      .send(payload);

    expect(resp.status).toBe(200);

    const followup = inserts.find(
      (c) => c.table === followupQueueItemsTable,
    );
    expect(followup).toBeDefined();
    expect(followup?.values).toMatchObject({
      triggerType: "missed_call",
      customerId:  MOCK_CUSTOMER.id,
      status:      "open",
    });
  });

  it("creates a voicemail followup for call.recording.completed", async () => {
    // For recording events the call details sit one level deeper under data.object.call
    const payload = {
      type: "call.recording.completed",
      data: {
        object: {
          url: "https://storage.openphone.com/recordings/rec-abc123.mp3",
          call: {
            from: CALLER,
            to:   [{ phoneNumber: COMPANY_LINE }],
          },
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = openPhoneSig(OP_SECRET, rawBody);

    setupSelectSequence([[MOCK_TENANT], [MOCK_TENANT], [MOCK_CUSTOMER]]);
    const inserts = captureInserts();

    const resp = await request(app)
      .post("/api/communications/webhook")
      .set("Content-Type", "application/json")
      .set("x-openphone-signature", sig)
      .send(payload);

    expect(resp.status).toBe(200);

    const followup = inserts.find(
      (c) => c.table === followupQueueItemsTable,
    );
    expect(followup).toBeDefined();
    expect(followup?.values).toMatchObject({
      triggerType: "voicemail",
      customerId:  MOCK_CUSTOMER.id,
      status:      "open",
    });
  });
});
