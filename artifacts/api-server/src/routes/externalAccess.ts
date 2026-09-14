import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, externalAccessAuditTable, externalConnectionRateLimitsTable, externalConnectionsTable, externalOAuthClientsTable } from "@workspace/db";
import { decryptSecretConfig, encryptSecretConfig } from "../lib/secretsCrypto";
import { isOwnerRole } from "../lib/roles";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import {
  appendExternalAudit, externalAccessCatalog, makeExternalToken, serializeConnection, validateConnectionInput,
} from "../lib/externalAccess";

const router: IRouter = Router();

async function requireOwner(req: Request, res: Response): Promise<{ tenantId: number; userId: number } | null> {
  const identity = verifiedStaffIdentity(res);
  if (!await isOwnerRole(identity.tenantId, identity.userId)) {
    res.status(403).json({ error: "Company owner role required" });
    return null;
  }
  return identity;
}
function requestId(req: Request): string | undefined {
  return typeof req.id === "string" ? req.id : undefined;
}
async function auditStaffConnection(row: typeof externalConnectionsTable.$inferSelect, action: string, req: Request): Promise<void> {
  await appendExternalAudit({ id: row.id, tenantId: row.tenantId, name: row.name }, action, "management", "allowed", requestId(req));
}

router.use((req, res, next) => { void requireVerifiedStaff(req, res, next); });

router.get("/external-access/catalog", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  res.json(externalAccessCatalog);
});

router.get("/external-access/connections", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const rows = await db.select().from(externalConnectionsTable)
    .where(eq(externalConnectionsTable.tenantId, identity.tenantId)).orderBy(desc(externalConnectionsTable.createdAt));
  res.json(rows.map(serializeConnection));
});

router.post("/external-access/connections", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const parsed = validateConnectionInput(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const generated = makeExternalToken();
  const [connection] = await db.insert(externalConnectionsTable).values({
    tenantId: identity.tenantId, createdByUserId: identity.userId, name: parsed.data.name as string,
    description: parsed.data.description as string, mode: parsed.data.mode as string, provider: parsed.data.provider as string,
    scopes: parsed.data.scopes as string[], allowWrites: parsed.data.allowWrites as boolean,
    expiresAt: parsed.data.expiresAt as Date, tokenHash: generated.tokenHash, tokenPrefix: generated.tokenPrefix,
  }).returning();
  await auditStaffConnection(connection, "connection.created", req);
  res.status(201).json({ connection: serializeConnection(connection), token: generated.token });
});

router.patch("/external-access/connections/:id", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [existing] = await db.select().from(externalConnectionsTable).where(and(eq(externalConnectionsTable.id, id), eq(externalConnectionsTable.tenantId, identity.tenantId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }
  if (existing.revokedAt) { res.status(409).json({ error: "Revoked connections cannot be updated" }); return; }
  const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const [oauthClient] = await db.select({ id: externalOAuthClientsTable.id }).from(externalOAuthClientsTable).where(eq(externalOAuthClientsTable.connectionId, existing.id)).limit(1);
  if (oauthClient && ("mode" in raw || "provider" in raw)) {
    res.status(409).json({ error: "OAuth MCP connections are bound to the MCP protected resource and cannot change protocol mode" });
    return;
  }
  const merged = {
    name: raw.name ?? existing.name, description: raw.description ?? existing.description,
    mode: raw.mode ?? existing.mode, provider: raw.provider ?? existing.provider, scopes: raw.scopes ?? existing.scopes,
    allowWrites: raw.allowWrites ?? existing.allowWrites, expiresAt: raw.expiresAt ?? existing.expiresAt.toISOString(),
    // Pause/name/description/expiry changes do not broaden access. Scope/write
    // changes must carry a fresh explicit acknowledgment.
    riskAcknowledged: "scopes" in raw || "allowWrites" in raw ? raw.riskAcknowledged : true,
  };
  const parsed = validateConnectionInput(merged);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const update: Partial<typeof externalConnectionsTable.$inferInsert> = {
    name: parsed.data.name as string, description: parsed.data.description as string, mode: parsed.data.mode as string,
    provider: parsed.data.provider as string, scopes: parsed.data.scopes as string[], allowWrites: parsed.data.allowWrites as boolean,
    expiresAt: parsed.data.expiresAt as Date,
  };
  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") { res.status(400).json({ error: "enabled must be boolean" }); return; }
    update.enabled = raw.enabled;
  }
  const [connection] = await db.update(externalConnectionsTable).set(update).where(eq(externalConnectionsTable.id, existing.id)).returning();
  await auditStaffConnection(connection, "connection.updated", req);
  res.json(serializeConnection(connection));
});

router.post("/external-access/connections/:id/rotate", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [existing] = await db.select().from(externalConnectionsTable).where(and(eq(externalConnectionsTable.id, id), eq(externalConnectionsTable.tenantId, identity.tenantId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }
  if (existing.revokedAt) { res.status(409).json({ error: "Revoked connections cannot be rotated" }); return; }
  const [oauthClient] = await db.select({ id: externalOAuthClientsTable.id }).from(externalOAuthClientsTable).where(eq(externalOAuthClientsTable.connectionId, existing.id)).limit(1);
  if (oauthClient) { res.status(409).json({ error: "OAuth MCP connections do not have a reusable bearer token; authorize the registered client instead" }); return; }
  const generated = makeExternalToken();
  const [connection] = await db.update(externalConnectionsTable).set({ tokenHash: generated.tokenHash, tokenPrefix: generated.tokenPrefix }).where(eq(externalConnectionsTable.id, existing.id)).returning();
  await auditStaffConnection(connection, "connection.rotated", req);
  res.json({ connection: serializeConnection(connection), token: generated.token });
});

router.post("/external-access/connections/:id/revoke", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [connection] = await db.update(externalConnectionsTable).set({ revokedAt: new Date(), enabled: false })
    .where(and(eq(externalConnectionsTable.id, id), eq(externalConnectionsTable.tenantId, identity.tenantId), isNull(externalConnectionsTable.revokedAt))).returning();
  if (!connection) { res.status(404).json({ error: "Active connection not found" }); return; }
  // Minute buckets are disposable rate-limit state; removing them at revoke
  // prevents abandoned connections from retaining bucket rows.
  await db.delete(externalConnectionRateLimitsTable).where(eq(externalConnectionRateLimitsTable.connectionId, connection.id));
  await auditStaffConnection(connection, "connection.revoked", req);
  res.json(serializeConnection(connection));
});

router.put("/external-access/connections/:id/webhook-secret", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const secret = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).secret : undefined;
  if (typeof secret !== "string" || secret.length < 8 || secret.length > 4096) { res.status(400).json({ error: "secret must be 8-4096 characters" }); return; }
  const [existing] = await db.select().from(externalConnectionsTable).where(and(eq(externalConnectionsTable.id, id), eq(externalConnectionsTable.tenantId, identity.tenantId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }
  if (existing.provider !== "quo" || existing.mode !== "webhook") { res.status(409).json({ error: "Webhook secrets are only supported for Quo webhook connections" }); return; }
  const [connection] = await db.update(externalConnectionsTable).set({ webhookSecretEncrypted: encryptSecretConfig({ signingSecret: secret }) }).where(eq(externalConnectionsTable.id, existing.id)).returning();
  await auditStaffConnection(connection, "connection.webhook_secret_set", req);
  res.json(serializeConnection(connection));
});

router.get("/external-access/audit", async (req, res): Promise<void> => {
  const identity = await requireOwner(req, res); if (!identity) return;
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) { res.status(400).json({ error: "limit must be 1-100" }); return; }
  const connectionId = typeof req.query.connectionId === "string" ? req.query.connectionId : undefined;
  const rows = await db.select().from(externalAccessAuditTable).where(and(
    eq(externalAccessAuditTable.tenantId, identity.tenantId),
    connectionId ? eq(externalAccessAuditTable.connectionId, connectionId) : undefined,
  )).orderBy(desc(externalAccessAuditTable.createdAt)).limit(rawLimit);
  res.json(rows.map((row) => ({
    id: row.id, connectionId: row.connectionId, connectionName: row.connectionName, action: row.action,
    transport: row.transport, status: row.status, requestId: row.requestId ?? null, createdAt: row.createdAt.toISOString(),
  })));
});

export default router;