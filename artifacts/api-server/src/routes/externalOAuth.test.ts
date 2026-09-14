import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const table = (columns: string[]) => Object.fromEntries(columns.map((column) => [column, column]));
  return {
    accessTokens: table(["connectionId", "tokenHash", "scopes", "allowWrites", "expiresAt"]),
    authorizationCodes: table(["codeHash", "clientId", "redirectUri", "resource", "expiresAt", "consumedAt"]),
    authorizationRequests: table(["id", "tenantId", "connectionId", "clientId", "redirectUri", "resource", "scopes", "codeChallenge", "state", "decision", "decidedByUserId", "expiresAt"]),
    authorizationRateLimits: table(["clientId", "ipHash", "minuteBucket", "count"]),
    clients: table(["clientId", "connectionId", "clientName", "redirectUris"]),
    connections: table(["id", "tenantId", "createdByUserId", "name", "description", "mode", "provider", "scopes", "allowWrites", "enabled", "expiresAt", "revokedAt", "tokenHash", "webhookSecretEncrypted", "tokenPrefix", "createdAt"]),
    users: table(["id", "tenantId", "isActive", "role"]),
    codeUpdates: [] as Record<string, unknown>[],
    requestUpdates: [] as Record<string, unknown>[],
    connectionRows: [] as Record<string, unknown>[],
    inserts: [] as { target: unknown; values: Record<string, unknown> }[],
    rateAllowed: true,
    identity: { tenantId: 7, userId: 4 } as { tenantId: number; userId: number } | null,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values, desc: (value: unknown) => value, eq: (...values: unknown[]) => values,
  gt: (...values: unknown[]) => values, isNull: (value: unknown) => value, lt: (...values: unknown[]) => values, sql: () => ({}),
}));
vi.mock("@workspace/db", () => {
  const select = () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => state.connectionRows }) }),
        where: () => ({ limit: async () => state.connectionRows }),
      }),
      where: () => ({ limit: async () => state.connectionRows }),
    }),
  });
  const matchColumnValue = (value: unknown, column: unknown): unknown => {
    if (!Array.isArray(value)) return undefined;
    if (value[0] === column) return value[1];
    for (const item of value) {
      const match = matchColumnValue(item, column);
      if (match !== undefined) return match;
    }
    return undefined;
  };
  const update = (target: unknown) => ({
        set: () => ({
          where: (condition: unknown) => ({
            returning: async () => target === state.authorizationCodes
              ? (matchColumnValue(condition, state.authorizationCodes.codeChallenge) === state.codeUpdates[0]?.codeChallenge && state.codeUpdates.length ? [state.codeUpdates.shift()] : [])
              : target === state.authorizationRequests
                ? (state.requestUpdates.length ? [state.requestUpdates.shift()] : [])
                : [],
          }),
        }),
      });
  const insert = (target: unknown) => ({ values: async (values: Record<string, unknown>) => { state.inserts.push({ target, values }); return []; } });
  const remove = () => ({ where: async () => undefined });
  const db: any = {
    select, update, insert, delete: remove, execute: async () => ({ rows: state.rateAllowed ? [{ count: 1 }] : [] }),
    transaction: async <T>(work: (tx: typeof db) => Promise<T>) => work(db),
  };
  return {
    db,
    externalConnectionsTable: state.connections, externalOAuthAccessTokensTable: state.accessTokens,
    externalOAuthAuthorizationCodesTable: state.authorizationCodes, externalOAuthAuthorizationRequestsTable: state.authorizationRequests,
    externalOAuthAuthorizationRateLimitsTable: state.authorizationRateLimits, externalOAuthClientsTable: state.clients, usersTable: state.users,
  };
});
vi.mock("../lib/externalAccess", () => ({
  EXTERNAL_SCOPES: ["customers:read", "customers:contact", "jobs:read", "equipment:read", "invoices:read", "tasks:read", "tasks:create", "communications:read", "communications:content", "communications:ingest"],
  appendExternalAudit: vi.fn(), makeExternalToken: () => ({ tokenHash: "bootstrap", tokenPrefix: "redacted" }),
  serializeConnection: (row: unknown) => row, validateConnectionInput: () => ({ ok: true, data: {} }),
}));
vi.mock("../lib/roles", () => ({ isOwnerRole: vi.fn(async () => true) }));
vi.mock("../lib/verifiedStaff", () => ({ resolveVerifiedStaffIdentity: vi.fn(async () => state.identity) }));

import externalOAuthRouter from "./externalOAuth";
import { oauthErrorRedirect, parseRequestedScopes, pkceS256, validateRedirectUris } from "../lib/externalOAuth";

function app() {
  const server = express();
  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(externalOAuthRouter);
  return server;
}
const connection = {
  id: "connection-1", tenantId: 7, createdByUserId: 4, name: "Assistant", description: "", mode: "mcp", provider: "generic",
  scopes: ["customers:read"], allowWrites: false, enabled: true, expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null, tokenHash: "bootstrap", webhookSecretEncrypted: null, tokenPrefix: "OAuth only", createdAt: new Date(),
};
const verifier = "A".repeat(43);

describe("remote MCP OAuth consent, redirects, and authorization-code reuse", () => {
  beforeEach(() => {
    process.env.OAUTH_ISSUER = "https://app.example";
    state.codeUpdates = [];
    state.requestUpdates = [];
    state.connectionRows = [connection];
    state.inserts = [];
    state.rateAllowed = true;
    state.identity = { tenantId: 7, userId: 4 };
  });

  it("requires exact registered HTTPS redirects and never lets a requested scope expand the connection grant", () => {
    expect(validateRedirectUris(["https://assistant.example/callback"]).ok).toBe(true);
    expect(validateRedirectUris(["https://assistant.example/callback#fragment"]).ok).toBe(false);
    expect(validateRedirectUris(["http://assistant.example/callback"]).ok).toBe(false);
    expect(parseRequestedScopes("customers:read invoices:read", ["customers:read"])).toMatchObject({ ok: false });
  });

  it("throttles public authorization requests before inserting pending consent state", async () => {
    state.rateAllowed = false;
    state.connectionRows = [{
      client: { clientId: "client-1", redirectUris: ["https://assistant.example/callback"] },
      connection,
      owner: { isActive: true, role: "company_owner" },
    }];
    const response = await request(app()).get("/oauth/authorize").query({
      response_type: "code", client_id: "client-1", redirect_uri: "https://assistant.example/callback",
      resource: "https://app.example/api/external/mcp", code_challenge: pkceS256(verifier), code_challenge_method: "S256",
    });
    expect(response.status).toBe(429);
    expect(response.body.error).toBe("slow_down");
    expect(state.inserts.some((insert) => insert.target === state.authorizationRequests)).toBe(false);
  });

  it("returns consent approval only as an exact registered redirect with code and preserved state", async () => {
    state.requestUpdates = [{
      id: "request-1", tenantId: 7, connectionId: connection.id, clientId: "client-1",
      redirectUri: "https://assistant.example/callback?existing=yes", resource: "https://app.example/api/external/mcp",
      scopes: ["customers:read"], codeChallenge: pkceS256(verifier), state: "opaque-state", expiresAt: new Date(Date.now() + 60_000),
    }];
    const response = await request(app()).post("/oauth/consent/request-1")
      .set("x-staff-session", "owner-session").send({ decision: "approve" });
    expect(response.status).toBe(200);
    const redirect = new URL(response.body.redirectTo);
    expect(redirect.origin + redirect.pathname).toBe("https://assistant.example/callback");
    expect(redirect.searchParams.get("existing")).toBe("yes");
    expect(redirect.searchParams.get("state")).toBe("opaque-state");
    expect(redirect.searchParams.get("code")).toMatch(/^oac_/);
    expect(redirect.searchParams.get("iss")).toBe("https://app.example");
    expect(state.inserts.some((insert) => insert.target === state.authorizationCodes && "codeHash" in insert.values)).toBe(true);
  });

  it("atomically consumes an authorization code, rejecting a second token exchange", async () => {
    state.connectionRows = [{ connection, owner: { isActive: true, role: "company_owner" } }];
    state.codeUpdates = [{
      connectionId: connection.id, tenantId: 7, clientId: "client-1", redirectUri: "https://assistant.example/callback", resource: "https://app.example/api/external/mcp",
      scopes: ["customers:read"], codeChallenge: pkceS256(verifier), expiresAt: new Date(Date.now() + 60_000),
    }];
    const form = { grant_type: "authorization_code", client_id: "client-1", code: "oac_once", redirect_uri: "https://assistant.example/callback", resource: "https://app.example/api/external/mcp", code_verifier: verifier };
    const first = await request(app()).post("/oauth/token").type("form").send(form);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ token_type: "Bearer", scope: "customers:read" });
    expect(first.body.access_token).toMatch(/^eao_/);
    const second = await request(app()).post("/oauth/token").type("form").send(form);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
  });

  it("rejects a wrong PKCE verifier without consuming the code, then permits its correct verifier", async () => {
    state.connectionRows = [{ connection, owner: { isActive: true, role: "company_owner" } }];
    state.codeUpdates = [{
      connectionId: connection.id, tenantId: 7, clientId: "client-1", redirectUri: "https://assistant.example/callback", resource: "https://app.example/api/external/mcp",
      scopes: ["customers:read"], codeChallenge: pkceS256(verifier), expiresAt: new Date(Date.now() + 60_000),
    }];
    const response = await request(app()).post("/oauth/token").type("form").send({
      grant_type: "authorization_code", client_id: "client-1", code: "oac_wrong_verifier",
      redirect_uri: "https://assistant.example/callback", resource: "https://app.example/api/external/mcp", code_verifier: "B".repeat(43),
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_grant");
    expect(state.inserts.some((insert) => insert.target === state.accessTokens)).toBe(false);
    const correct = await request(app()).post("/oauth/token").type("form").send({
      grant_type: "authorization_code", client_id: "client-1", code: "oac_wrong_verifier",
      redirect_uri: "https://assistant.example/callback", resource: "https://app.example/api/external/mcp", code_verifier: verifier,
    });
    expect(correct.status).toBe(200);
  });

  it("does not decide a consent request from another tenant", async () => {
    state.identity = { tenantId: 8, userId: 9 };
    const response = await request(app()).post("/oauth/consent/request-from-tenant-7")
      .set("x-staff-session", "other-owner-session").send({ decision: "approve" });
    expect(response.status).toBe(409);
    expect(state.inserts).toEqual([]);
  });

  it("builds an access-denied redirect only from the registered redirect URI and identifies its issuer", () => {
    const redirect = new URL(oauthErrorRedirect("https://assistant.example/callback", "access_denied", "state-1", "https://app.example"));
    expect(redirect.origin).toBe("https://assistant.example");
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("state-1");
    expect(redirect.searchParams.get("iss")).toBe("https://app.example");
  });
});