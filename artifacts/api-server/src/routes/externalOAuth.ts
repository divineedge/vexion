import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  db, externalConnectionsTable, externalOAuthAccessTokensTable, externalOAuthAuthorizationCodesTable,
  externalOAuthAuthorizationRequestsTable, externalOAuthAuthorizationRateLimitsTable, externalOAuthClientsTable, usersTable,
} from "@workspace/db";
import { appendExternalAudit, makeExternalToken, serializeConnection, validateConnectionInput, type ExternalConnectionContext, type ExternalScope } from "../lib/externalAccess";
import {
  authorizationServerMetadata, isValidPkceChallenge, isValidPkceVerifier, oauthEndpoints, oauthErrorRedirect,
  parseRequestedScopes, pkceS256, protectedResourceMetadata, randomOAuthValue, sha256, validateRedirectUris,
} from "../lib/externalOAuth";
import { isOwnerRole } from "../lib/roles";
import { resolveVerifiedStaffIdentity } from "../lib/verifiedStaff";

const router: IRouter = Router();
export const oauthDiscoveryRouter: IRouter = Router();
const AUTHORIZATION_REQUEST_TTL_MS = 5 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_AUTHORIZATION_REQUESTS_PER_CLIENT_PER_MINUTE = 20;
const MAX_AUTHORIZATION_REQUESTS_PER_CLIENT_IP_PER_MINUTE = 10;

function requestId(req: Request): string | undefined {
  return typeof req.id === "string" ? req.id : undefined;
}
function oauthError(res: Response, error: string, description: string, status = 400): void {
  res.status(status).json({ error, error_description: description });
}
function stringQuery(value: unknown): string | null {
  return typeof value === "string" && value.length <= 2048 ? value : null;
}
function contextFor(connection: typeof externalConnectionsTable.$inferSelect, scopes = connection.scopes as ExternalScope[], allowWrites = connection.allowWrites): ExternalConnectionContext {
  return {
    id: connection.id, tenantId: connection.tenantId, createdByUserId: connection.createdByUserId, name: connection.name,
    mode: connection.mode as ExternalConnectionContext["mode"], provider: connection.provider as ExternalConnectionContext["provider"],
    scopes, allowWrites, tokenHash: connection.tokenHash, webhookSecretEncrypted: connection.webhookSecretEncrypted,
  };
}
function activeOwnerConnection(connection: typeof externalConnectionsTable.$inferSelect, owner: { isActive: boolean; role: string }): boolean {
  return connection.enabled && !connection.revokedAt && connection.expiresAt > new Date() && owner.isActive && owner.role === "company_owner";
}
async function verifiedOwner(req: Request, res: Response): Promise<{ tenantId: number; userId: number } | null> {
  // Deliberately require the app's non-browser-readable session header. A cross-site
  // form cannot turn an ambient browser cookie into OAuth approval.
  if (!req.header("x-staff-session")) {
    res.status(401).json({ error: "Verified owner session required to decide OAuth consent" });
    return null;
  }
  const identity = await resolveVerifiedStaffIdentity(req);
  if (!identity) { res.status(401).json({ error: "Verified owner session required" }); return null; }
  if (!await isOwnerRole(identity.tenantId, identity.userId)) {
    res.status(403).json({ error: "Company owner role required" });
    return null;
  }
  return identity;
}
function consentWarnings(scopes: string[], allowWrites: boolean): { sensitive: boolean; writes: boolean } {
  const sensitive = new Set(["customers:contact", "invoices:read", "tasks:read", "tasks:create", "communications:read", "communications:content", "communications:ingest"]);
  return { sensitive: scopes.some((scope) => sensitive.has(scope)), writes: allowWrites };
}
function authorizationIpHash(req: Request): string {
  // Do not trust X-Forwarded-For unless a deployment explicitly configures a
  // trusted proxy. Hash network information before it reaches persistence.
  return sha256(req.socket.remoteAddress ?? req.ip ?? "unknown");
}
async function consumeAuthorizationRateLimit(clientId: string, req: Request): Promise<boolean> {
  const minuteBucket = new Date(); minuteBucket.setUTCSeconds(0, 0);
  const cutoff = new Date(minuteBucket.valueOf() - 2 * 60 * 60 * 1000);
  const ipHash = authorizationIpHash(req);
  await db.delete(externalOAuthAuthorizationRateLimitsTable).where(lt(externalOAuthAuthorizationRateLimitsTable.minuteBucket, cutoff));
  const consume = (bucketIpHash: string, maximum: number) => db.execute(sql`
    INSERT INTO ${externalOAuthAuthorizationRateLimitsTable} ("client_id", "ip_hash", "minute_bucket", "count")
    VALUES (${clientId}, ${bucketIpHash}, ${minuteBucket.toISOString()}::timestamptz, 1)
    ON CONFLICT ("client_id", "ip_hash", "minute_bucket")
    DO UPDATE SET "count" = ${externalOAuthAuthorizationRateLimitsTable.count} + 1
    WHERE ${externalOAuthAuthorizationRateLimitsTable.count} < ${maximum}
    RETURNING ${externalOAuthAuthorizationRateLimitsTable.count}`);
  // A second client-wide bucket prevents a distributed source from turning one
  // valid public client registration into an unlimited pending-consent sink.
  const perClient = await consume("__all_networks__", MAX_AUTHORIZATION_REQUESTS_PER_CLIENT_PER_MINUTE);
  if (perClient.rows.length !== 1) return false;
  const perClientIp = await consume(ipHash, MAX_AUTHORIZATION_REQUESTS_PER_CLIENT_IP_PER_MINUTE);
  return perClientIp.rows.length === 1;
}
async function cleanupExpiredOAuthState(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await Promise.all([
    db.delete(externalOAuthAuthorizationRequestsTable).where(lt(externalOAuthAuthorizationRequestsTable.expiresAt, cutoff)),
    db.delete(externalOAuthAuthorizationCodesTable).where(lt(externalOAuthAuthorizationCodesTable.expiresAt, cutoff)),
    db.delete(externalOAuthAccessTokensTable).where(lt(externalOAuthAccessTokensTable.expiresAt, cutoff)),
  ]);
}

oauthDiscoveryRouter.get("/.well-known/oauth-protected-resource/api/external/mcp", (_req, res): void => {
  const metadata = protectedResourceMetadata();
  if (!metadata) { res.status(503).json({ error: "OAuth issuer is not configured" }); return; }
  res.set("Cache-Control", "public, max-age=300").json(metadata);
});
oauthDiscoveryRouter.get("/.well-known/oauth-authorization-server", (_req, res): void => {
  const metadata = authorizationServerMetadata();
  if (!metadata) { res.status(503).json({ error: "OAuth issuer is not configured" }); return; }
  res.set("Cache-Control", "public, max-age=300").json(metadata);
});

router.get("/oauth/authorize", async (req, res): Promise<void> => {
  const endpoints = oauthEndpoints();
  if (!endpoints) { oauthError(res, "server_error", "OAuth issuer is not configured", 503); return; }
  const clientId = stringQuery(req.query.client_id);
  const redirectUri = stringQuery(req.query.redirect_uri);
  const resource = stringQuery(req.query.resource);
  const state = req.query.state == null ? null : stringQuery(req.query.state);
  const codeChallenge = stringQuery(req.query.code_challenge);
  if (req.query.response_type !== "code" || !clientId || !redirectUri || !resource || !codeChallenge || req.query.code_challenge_method !== "S256" || (req.query.state != null && !state)) {
    oauthError(res, "invalid_request", "response_type=code, registered redirect_uri, resource, state (when present), and S256 PKCE are required");
    return;
  }
  if (resource !== endpoints.resource || !isValidPkceChallenge(codeChallenge)) {
    oauthError(res, "invalid_request", "Invalid resource or S256 PKCE code challenge");
    return;
  }
  const [row] = await db.select({ client: externalOAuthClientsTable, connection: externalConnectionsTable, owner: usersTable })
    .from(externalOAuthClientsTable)
    .innerJoin(externalConnectionsTable, eq(externalConnectionsTable.id, externalOAuthClientsTable.connectionId))
    .innerJoin(usersTable, and(eq(usersTable.id, externalConnectionsTable.createdByUserId), eq(usersTable.tenantId, externalConnectionsTable.tenantId)))
    .where(eq(externalOAuthClientsTable.clientId, clientId)).limit(1);
  if (!row || !row.client.redirectUris.includes(redirectUri) || !activeOwnerConnection(row.connection, row.owner)) {
    oauthError(res, "invalid_request", "Unknown client, redirect URI, or inactive connection");
    return;
  }
  const scopes = parseRequestedScopes(req.query.scope, row.connection.scopes);
  if (!scopes.ok) { oauthError(res, "invalid_scope", scopes.error); return; }
  if (!await consumeAuthorizationRateLimit(clientId, req)) {
    // Do not create an audit row for each rejected public request. The bounded
    // rate bucket itself is enough to diagnose abuse without becoming an
    // attacker-controlled audit sink.
    oauthError(res, "slow_down", "Too many authorization requests; try again shortly", 429);
    return;
  }
  await cleanupExpiredOAuthState();
  const [authorization] = await db.insert(externalOAuthAuthorizationRequestsTable).values({
    tenantId: row.connection.tenantId, connectionId: row.connection.id, clientId, redirectUri, resource,
    scopes: scopes.value, codeChallenge, state, expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
  }).returning({ id: externalOAuthAuthorizationRequestsTable.id });
  await appendExternalAudit(contextFor(row.connection, scopes.value), "oauth.authorization.requested", "oauth", "allowed", requestId(req));
  // Do not copy client redirect, state, PKCE, or scopes into the consent-page URL.
  res.redirect(302, `${endpoints.consentPage}?oauth_consent=${encodeURIComponent(authorization.id)}`);
});

router.get("/oauth/consent/:id", async (req, res): Promise<void> => {
  const identity = await verifiedOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [row] = await db.select({ request: externalOAuthAuthorizationRequestsTable, client: externalOAuthClientsTable, connection: externalConnectionsTable })
    .from(externalOAuthAuthorizationRequestsTable)
    .innerJoin(externalOAuthClientsTable, eq(externalOAuthClientsTable.clientId, externalOAuthAuthorizationRequestsTable.clientId))
    .innerJoin(externalConnectionsTable, eq(externalConnectionsTable.id, externalOAuthAuthorizationRequestsTable.connectionId))
    .where(and(eq(externalOAuthAuthorizationRequestsTable.id, id), eq(externalOAuthAuthorizationRequestsTable.tenantId, identity.tenantId), gt(externalOAuthAuthorizationRequestsTable.expiresAt, new Date()), isNull(externalOAuthAuthorizationRequestsTable.decision)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "OAuth authorization request is missing, expired, or already decided" }); return; }
  res.json({
    requestId: row.request.id, client: { name: row.client.clientName, clientId: row.client.clientId },
    connection: { id: row.connection.id, name: row.connection.name, expiresAt: row.connection.expiresAt.toISOString() },
    redirectUri: row.request.redirectUri, scopes: row.request.scopes,
    warnings: consentWarnings(row.request.scopes, row.connection.allowWrites), expiresAt: row.request.expiresAt.toISOString(),
  });
});

router.post("/oauth/consent/:id", async (req, res): Promise<void> => {
  const endpoints = oauthEndpoints();
  if (!endpoints) { oauthError(res, "server_error", "OAuth issuer is not configured", 503); return; }
  const identity = await verifiedOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const decision = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).decision : undefined;
  if (decision !== "approve" && decision !== "deny") { oauthError(res, "invalid_request", "decision must be approve or deny"); return; }
  const [authorization] = await db.update(externalOAuthAuthorizationRequestsTable)
    .set({ decision, decidedByUserId: identity.userId })
    .where(and(eq(externalOAuthAuthorizationRequestsTable.id, id), eq(externalOAuthAuthorizationRequestsTable.tenantId, identity.tenantId), gt(externalOAuthAuthorizationRequestsTable.expiresAt, new Date()), isNull(externalOAuthAuthorizationRequestsTable.decision)))
    .returning();
  if (!authorization) { res.status(409).json({ error: "OAuth authorization request is missing, expired, or already decided" }); return; }
  const [connection] = await db.select().from(externalConnectionsTable).where(and(eq(externalConnectionsTable.id, authorization.connectionId), eq(externalConnectionsTable.tenantId, identity.tenantId))).limit(1);
  if (!connection) { res.status(404).json({ error: "Connection not found" }); return; }
  const context = contextFor(connection, authorization.scopes as ExternalScope[]);
  if (decision === "deny") {
    await appendExternalAudit(context, "oauth.consent.denied", "oauth", "denied", requestId(req));
    res.json({ redirectTo: oauthErrorRedirect(authorization.redirectUri, "access_denied", authorization.state, endpoints.issuer) });
    return;
  }
  const code = randomOAuthValue("oac");
  await db.insert(externalOAuthAuthorizationCodesTable).values({
    tenantId: identity.tenantId, connectionId: authorization.connectionId, clientId: authorization.clientId,
    redirectUri: authorization.redirectUri, resource: authorization.resource, scopes: authorization.scopes, codeHash: sha256(code),
    codeChallenge: authorization.codeChallenge, expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
  });
  await appendExternalAudit(context, "oauth.consent.approved", "oauth", "allowed", requestId(req));
  const redirect = new URL(authorization.redirectUri);
  redirect.searchParams.set("code", code);
  if (authorization.state) redirect.searchParams.set("state", authorization.state);
  // Advertised in AS metadata and returned verbatim so clients can perform the
  // RFC 9207 authorization-response issuer validation.
  redirect.searchParams.set("iss", endpoints.issuer);
  res.json({ redirectTo: redirect.toString() });
});

router.post("/oauth/token", async (req, res): Promise<void> => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const clientId = typeof body.client_id === "string" ? body.client_id : null;
  const code = typeof body.code === "string" ? body.code : null;
  const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : null;
  const resource = typeof body.resource === "string" ? body.resource : null;
  const verifier = body.code_verifier;
  const endpoints = oauthEndpoints();
  if (body.grant_type !== "authorization_code" || !clientId || !code || !redirectUri || !resource || !endpoints || resource !== endpoints.resource || !isValidPkceVerifier(verifier)) {
    oauthError(res, "invalid_request", "authorization_code, client_id, code, registered resource and redirect_uri, and a valid PKCE verifier are required");
    return;
  }
  const token = randomOAuthValue("eao");
  const result = await db.transaction(async (tx) => {
    // The PKCE hash participates in the same conditional update as code
    // consumption. A wrong verifier therefore cannot burn a valid code, and
    // exactly one concurrent exchange can proceed to token insertion.
    const [authorizationCode] = await tx.update(externalOAuthAuthorizationCodesTable).set({ consumedAt: new Date() })
      .where(and(eq(externalOAuthAuthorizationCodesTable.codeHash, sha256(code)), eq(externalOAuthAuthorizationCodesTable.clientId, clientId), eq(externalOAuthAuthorizationCodesTable.redirectUri, redirectUri), eq(externalOAuthAuthorizationCodesTable.resource, resource), eq(externalOAuthAuthorizationCodesTable.codeChallenge, pkceS256(verifier)), gt(externalOAuthAuthorizationCodesTable.expiresAt, new Date()), isNull(externalOAuthAuthorizationCodesTable.consumedAt)))
      .returning();
    if (!authorizationCode) return { kind: "invalid" as const };
    const [row] = await tx.select({ connection: externalConnectionsTable, owner: usersTable })
      .from(externalConnectionsTable)
      .innerJoin(usersTable, and(eq(usersTable.id, externalConnectionsTable.createdByUserId), eq(usersTable.tenantId, externalConnectionsTable.tenantId)))
      .where(and(eq(externalConnectionsTable.id, authorizationCode.connectionId), eq(externalConnectionsTable.tenantId, authorizationCode.tenantId))).limit(1);
    if (!row || !activeOwnerConnection(row.connection, row.owner)) return { kind: "inactive" as const, row, authorizationCode };
    const expiresAt = new Date(Math.min(Date.now() + ACCESS_TOKEN_TTL_MS, row.connection.expiresAt.valueOf()));
    if (expiresAt <= new Date()) return { kind: "inactive" as const, row, authorizationCode };
    await tx.delete(externalOAuthAccessTokensTable).where(lt(externalOAuthAccessTokensTable.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    await tx.insert(externalOAuthAccessTokensTable).values({
      connectionId: row.connection.id, tokenHash: sha256(token), scopes: authorizationCode.scopes,
      allowWrites: row.connection.allowWrites, expiresAt,
    });
    return { kind: "issued" as const, row, authorizationCode, expiresAt };
  });
  if (result.kind === "invalid") {
    oauthError(res, "invalid_grant", "Authorization code is invalid, expired, already used, or does not match PKCE");
    return;
  }
  if (result.kind === "inactive") {
    if (result.row) await appendExternalAudit(contextFor(result.row.connection, result.authorizationCode.scopes as ExternalScope[]), "oauth.token.denied", "oauth", "denied", requestId(req));
    oauthError(res, "invalid_grant", "Connection is no longer active");
    return;
  }
  await appendExternalAudit(contextFor(result.row.connection, result.authorizationCode.scopes as ExternalScope[]), "oauth.token.issued", "oauth", "allowed", requestId(req));
  res.set("Cache-Control", "no-store").json({
    access_token: token, token_type: "Bearer", expires_in: Math.floor((result.expiresAt.valueOf() - Date.now()) / 1000),
    scope: result.authorizationCode.scopes.join(" "),
  });
});

async function requireManagementOwner(req: Request, res: Response): Promise<{ tenantId: number; userId: number } | null> {
  return verifiedOwner(req, res);
}

router.post("/external-access/oauth-mcp-connections", async (req, res): Promise<void> => {
  const identity = await requireManagementOwner(req, res); if (!identity) return;
  const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const parsed = validateConnectionInput({ ...raw, mode: "mcp", provider: "generic" });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const redirectUris = validateRedirectUris(raw.redirectUris);
  if (!redirectUris.ok) { res.status(400).json({ error: redirectUris.error }); return; }
  const clientName = raw.clientName;
  if (typeof clientName !== "string" || !clientName.trim() || clientName.length > 100) {
    res.status(400).json({ error: "clientName must be 1-100 characters" }); return;
  }
  const endpoints = oauthEndpoints();
  if (!endpoints) { res.status(503).json({ error: "OAuth issuer is not configured" }); return; }
  const clientId = randomOAuthValue("eac");
  // External connections retain a hash-only credential column for legacy
  // transports. This random bootstrap value is intentionally never returned.
  const bootstrap = makeExternalToken();
  const result = await db.transaction(async (tx) => {
    const [connection] = await tx.insert(externalConnectionsTable).values({
      tenantId: identity.tenantId, createdByUserId: identity.userId, name: parsed.data.name as string,
      description: parsed.data.description as string, mode: "mcp", provider: "generic",
      scopes: parsed.data.scopes as string[], allowWrites: parsed.data.allowWrites as boolean,
      expiresAt: parsed.data.expiresAt as Date, tokenHash: bootstrap.tokenHash, tokenPrefix: "OAuth only",
    }).returning();
    await tx.insert(externalOAuthClientsTable).values({ connectionId: connection.id, clientId, clientName: clientName.trim(), redirectUris: redirectUris.value });
    return connection;
  });
  await appendExternalAudit(contextFor(result), "oauth.connection.created", "management", "allowed", requestId(req));
  res.status(201).json({ connection: serializeConnection(result), clientId, mcpUrl: endpoints.resource, authorizationServer: endpoints.issuer, protectedResource: endpoints.protectedResourceMetadata });
});

router.get("/external-access/oauth-mcp-connections", async (req, res): Promise<void> => {
  const identity = await requireManagementOwner(req, res); if (!identity) return;
  const rows = await db.select({ connection: externalConnectionsTable, client: externalOAuthClientsTable })
    .from(externalOAuthClientsTable).innerJoin(externalConnectionsTable, eq(externalConnectionsTable.id, externalOAuthClientsTable.connectionId))
    .where(eq(externalConnectionsTable.tenantId, identity.tenantId)).orderBy(desc(externalConnectionsTable.createdAt));
  res.json(rows.map(({ connection, client }) => ({ connection: serializeConnection(connection), clientId: client.clientId, clientName: client.clientName, redirectUris: client.redirectUris })));
});

export default router;