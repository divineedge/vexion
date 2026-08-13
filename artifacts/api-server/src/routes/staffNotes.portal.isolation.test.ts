/**
 * Security regression test: staff notes are never exposed via the customer portal.
 *
 * Verifies two properties:
 *  1. Any request that carries an x-portal-token header is rejected with 403
 *     before staff-note data is touched — even with a valid portal session.
 *  2. A request with a valid staff session token succeeds (returns 200 or 400
 *     for missing query params) — confirming the endpoint is reachable by staff.
 *
 * Skipped automatically when DATABASE_URL is absent (e.g. bare CI without a
 * DB sidecar) so the suite stays green everywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import {
  db,
  tenantsTable,
  customersTable,
  usersTable,
  staffSessionsTable,
  customerOtpSessionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import staffNotesRouter from "./staffNotes";

// ---------------------------------------------------------------------------
// Guard — skip when there is no real database
// ---------------------------------------------------------------------------
const RUN = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(staffNotesRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)("staff notes portal isolation", () => {
  let tenantId: number;
  let customerId: number;
  let staffUserId: number;

  /** Raw (un-hashed) staff session token */
  const rawStaffToken = crypto.randomBytes(32).toString("hex");
  /** Raw (un-hashed) portal session token */
  const rawPortalToken = crypto.randomBytes(32).toString("hex");

  // Collected IDs for cleanup
  const insertedStaffSessionIds: number[] = [];
  const insertedPortalSessionIds: number[] = [];

  // ── Setup ─────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Tenant
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name: "__test_staff_notes_isolation__" })
      .returning({ id: tenantsTable.id });
    tenantId = tenant.id;

    // A customer for the portal session
    const [customer] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "__test_sn_customer__",
        email: "sn-portal@example.invalid",
        phone: "",
      })
      .returning({ id: customersTable.id });
    customerId = customer.id;

    // A staff user (active, employee role)
    const [staffUser] = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: "__test_sn_staff__",
        email: "sn-staff@example.invalid",
        passwordHash: "mock",
        role: "employee",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    staffUserId = staffUser.id;

    // Staff session — valid for 1 hour
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const [staffSession] = await db
      .insert(staffSessionsTable)
      .values({
        tenantId,
        userId: staffUserId,
        tokenHash: hashToken(rawStaffToken),
        expiresAt: future,
      })
      .returning({ id: staffSessionsTable.id });
    insertedStaffSessionIds.push(staffSession.id);

    // Portal (OTP) session for the customer — valid for 1 hour
    const [portalSession] = await db
      .insert(customerOtpSessionsTable)
      .values({
        tenantId,
        customerId,
        email: "sn-portal@example.invalid",
        otpHash: hashToken("000000"),
        sessionToken: hashToken(rawPortalToken),
        expiresAt: future,
      })
      .returning({ id: customerOtpSessionsTable.id });
    insertedPortalSessionIds.push(portalSession.id);
  });

  // ── Teardown ──────────────────────────────────────────────────────────────

  afterAll(async () => {
    if (insertedStaffSessionIds.length) {
      await db
        .delete(staffSessionsTable)
        .where(inArray(staffSessionsTable.id, insertedStaffSessionIds));
    }
    if (insertedPortalSessionIds.length) {
      await db
        .delete(customerOtpSessionsTable)
        .where(inArray(customerOtpSessionsTable.id, insertedPortalSessionIds));
    }
    await db.delete(usersTable).where(eq(usersTable.id, staffUserId));
    await db.delete(customersTable).where(eq(customersTable.id, customerId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  // ── Tests — portal cannot reach staff notes ───────────────────────────────

  it("GET /staff-notes returns 403 when a portal token is present", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("x-portal-token", rawPortalToken)
      .set("x-tenant-id", String(tenantId))
      .query({ entityType: "customer", entityId: String(customerId) });

    expect(res.status).toBe(403);
  });

  it("GET /staff-notes returns 403 even when both portal and staff tokens are present", async () => {
    // Simulates an attempt to smuggle staff credentials alongside a portal token.
    // The middleware must reject on portal token presence regardless.
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("x-portal-token", rawPortalToken)
      .set("x-staff-session", rawStaffToken)
      .set("x-tenant-id", String(tenantId))
      .query({ entityType: "customer", entityId: String(customerId) });

    expect(res.status).toBe(403);
  });

  it("GET /staff-notes returns 401 when no auth header is sent at all", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("x-tenant-id", String(tenantId))
      .query({ entityType: "customer", entityId: String(customerId) });

    expect(res.status).toBe(401);
  });

  it("GET /staff-notes returns 401 for an invalid (unknown) staff token", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("x-staff-session", "totally-invalid-token-xyz")
      .set("x-tenant-id", String(tenantId))
      .query({ entityType: "customer", entityId: String(customerId) });

    expect(res.status).toBe(401);
  });

  // ── Tests — staff can reach staff notes ───────────────────────────────────

  it("GET /staff-notes returns 200 for a valid staff session", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("x-staff-session", rawStaffToken)
      .query({ entityType: "customer", entityId: String(customerId) });

    // 200 with an empty array (no notes yet) — the critical assertion is that
    // a legitimate staff session is NOT blocked
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /staff-notes accepts Authorization: Bearer token for a valid staff session", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/staff-notes")
      .set("Authorization", `Bearer ${rawStaffToken}`)
      .query({ entityType: "customer", entityId: String(customerId) });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
