import crypto from "node:crypto";
import { and, desc, eq, gt, ilike, lt, or, sql } from "drizzle-orm";
import {
  communicationsLogTable,
  customersTable,
  db,
  equipmentTable,
  externalAccessAuditTable,
  externalConnectionRateLimitsTable,
  externalConnectionsTable,
  externalVoipEventsTable,
  externalWriteIdempotencyTable,
  internalTasksTable,
  invoicesTable,
  jobsTable,
  usersTable,
} from "@workspace/db";
import type { Request } from "express";

export const EXTERNAL_SCOPES = [
  "customers:read", "customers:contact", "jobs:read", "equipment:read", "invoices:read",
  "tasks:read", "tasks:create", "communications:read", "communications:content", "communications:ingest",
] as const;
export type ExternalScope = typeof EXTERNAL_SCOPES[number];
export type ExternalProvider = "generic" | "quo" | "ringcentral";
export type ExternalMode = "api" | "mcp" | "both" | "webhook";
export type NormalizedVoipEvent = {
  eventId: string; type: "call" | "sms"; direction: "inbound" | "outbound";
  from: string; to: string; occurredAt: string; status: string; durationSeconds?: number; body?: string;
};
export type ExternalConnectionContext = {
  id: string; tenantId: number; createdByUserId: number; name: string; mode: ExternalMode;
  provider: ExternalProvider; scopes: ExternalScope[]; allowWrites: boolean; tokenHash: string;
  webhookSecretEncrypted: string | null;
};

const MAX_REQUESTS_PER_MINUTE = 120;
const MAX_PAGE_SIZE = 100;
const MODES = new Set<ExternalMode>(["api", "mcp", "both", "webhook"]);
const PROVIDERS = new Set<ExternalProvider>(["generic", "quo", "ringcentral"]);

export const externalAccessCatalog = {
  permissions: [
    { id: "customers:read", label: "Customers: basic", description: "Basic customer identity and status; excludes contact details and notes.", sensitive: false, write: false },
    { id: "customers:contact", label: "Customers: contact", description: "Customer contact details. Requires Customers: basic.", sensitive: true, write: false },
    { id: "jobs:read", label: "Jobs: basic", description: "Basic scheduling and status; excludes notes, costs, and access codes.", sensitive: false, write: false },
    { id: "equipment:read", label: "Equipment: basic", description: "Business-wide basic equipment. This is an owner-delegated service credential, not a staff-role bypass; excludes costs, history, and private notes.", sensitive: false, write: false },
    { id: "invoices:read", label: "Invoices", description: "Invoice balances and status.", sensitive: true, write: false },
    { id: "tasks:read", label: "Follow-up tasks", description: "Office follow-up tasks, including free text.", sensitive: true, write: false },
    { id: "tasks:create", label: "Create follow-up tasks", description: "Create office follow-up tasks only. Requires write access.", sensitive: true, write: true },
    { id: "communications:read", label: "Communications: metadata", description: "Call/SMS metadata and contact information.", sensitive: true, write: false },
    { id: "communications:content", label: "Communications: content", description: "Message text. Requires Communications: metadata.", sensitive: true, write: false },
    { id: "communications:ingest", label: "Import communications", description: "Import normalized call/SMS events only. Requires write access.", sensitive: true, write: true },
  ],
  presets: [
    { id: "api-readonly", label: "Read-only API", description: "Minimum basic customer and job data for one trusted service. Scopes are tenant-wide, never crew filters.", scopes: ["customers:read", "jobs:read"], mode: "api", provider: "generic" },
    { id: "mcp-readonly", label: "Read-only MCP", description: "Read-only MCP connection for a trusted assistant. Scopes are tenant-wide, never crew filters.", scopes: ["customers:read", "jobs:read"], mode: "mcp", provider: "generic" },
    { id: "quo-webhook", label: "Quo call/SMS import", description: "Imports normalized Quo events only; no provider account is connected.", scopes: ["communications:ingest"], mode: "webhook", provider: "quo" },
    { id: "ringcentral-webhook", label: "RingCentral call/SMS import", description: "Imports normalized RingCentral events only; no provider account is connected.", scopes: ["communications:ingest"], mode: "webhook", provider: "ringcentral" },
  ],
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function makeExternalToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `eac_${crypto.randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: sha256(token), tokenPrefix: `${token.slice(0, 12)}…` };
}

export function validateConnectionInput(input: unknown, partial = false): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Invalid connection input" };
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (!partial || "name" in raw) {
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 100) return { ok: false, error: "name must be 1-100 characters" };
    out.name = raw.name.trim();
  }
  if ("description" in raw) {
    if (typeof raw.description !== "string" || raw.description.length > 1000) return { ok: false, error: "description must be at most 1000 characters" };
    out.description = raw.description;
  } else if (!partial) out.description = "";
  if (!partial || "mode" in raw) {
    if (typeof raw.mode !== "string" || !MODES.has(raw.mode as ExternalMode)) return { ok: false, error: "Invalid mode" };
    out.mode = raw.mode;
  }
  if (!partial || "provider" in raw) {
    if (typeof raw.provider !== "string" || !PROVIDERS.has(raw.provider as ExternalProvider)) return { ok: false, error: "Invalid provider" };
    out.provider = raw.provider;
  }
  if (!partial || "scopes" in raw) {
    if (!Array.isArray(raw.scopes) || raw.scopes.length > EXTERNAL_SCOPES.length || raw.scopes.some((scope) => typeof scope !== "string" || !EXTERNAL_SCOPES.includes(scope as ExternalScope))) return { ok: false, error: "Invalid scopes" };
    out.scopes = [...new Set(raw.scopes)] as ExternalScope[];
  }
  if ("allowWrites" in raw) {
    if (typeof raw.allowWrites !== "boolean") return { ok: false, error: "allowWrites must be boolean" };
    out.allowWrites = raw.allowWrites;
  } else if (!partial) out.allowWrites = false;
  if ("enabled" in raw && partial) {
    if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be boolean" };
    out.enabled = raw.enabled;
  }
  if (!partial || "expiresAt" in raw) {
    if (typeof raw.expiresAt !== "string") return { ok: false, error: "expiresAt is required" };
    const expiresAt = new Date(raw.expiresAt);
    if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date() || expiresAt.valueOf() > Date.now() + 366 * 24 * 60 * 60 * 1000) return { ok: false, error: "expiresAt must be in the next year" };
    out.expiresAt = expiresAt;
  }
  const scopes = (out.scopes ?? raw.scopes) as ExternalScope[] | undefined;
  const mode = (out.mode ?? raw.mode) as ExternalMode | undefined;
  const provider = (out.provider ?? raw.provider) as ExternalProvider | undefined;
  const allowWrites = (out.allowWrites ?? raw.allowWrites) as boolean | undefined;
  if (scopes) {
    if (scopes.includes("customers:contact") && !scopes.includes("customers:read")) return { ok: false, error: "customers:contact requires customers:read" };
    if (scopes.includes("communications:content") && !scopes.includes("communications:read")) return { ok: false, error: "communications:content requires communications:read" };
    if ((scopes.includes("tasks:create") || scopes.includes("communications:ingest")) && allowWrites !== true) return { ok: false, error: "Write scopes require allowWrites" };
  }
  if (mode && provider && ((mode === "webhook") !== (provider !== "generic"))) return { ok: false, error: "Generic connections use API/MCP modes; provider connections use webhook mode" };
  const permissionChanged = !partial || "scopes" in out || "allowWrites" in out;
  if (permissionChanged && raw.riskAcknowledged !== true) return { ok: false, error: "riskAcknowledged is required for permission changes" };
  return { ok: true, data: out };
}

export function serializeConnection(row: typeof externalConnectionsTable.$inferSelect) {
  return {
    id: row.id, name: row.name, description: row.description, mode: row.mode, provider: row.provider,
    scopes: row.scopes, allowWrites: row.allowWrites, enabled: row.enabled, expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), tokenPrefix: row.tokenPrefix,
    webhookSecretConfigured: Boolean(row.webhookSecretEncrypted),
  };
}

export async function appendExternalAudit(context: Pick<ExternalConnectionContext, "id" | "tenantId" | "name">, action: string, transport: string, status: "allowed" | "denied", requestId?: string): Promise<void> {
  await db.insert(externalAccessAuditTable).values({
    tenantId: context.tenantId, connectionId: context.id, connectionName: context.name, action, transport, status, requestId,
  });
}

function requestId(req: Request): string | undefined {
  return typeof req.id === "string" ? req.id : undefined;
}
function bearerFromRequest(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(header);
  return match?.[1] ?? null;
}
async function consumeRateLimit(connectionId: string): Promise<boolean> {
  const bucket = new Date(); bucket.setUTCSeconds(0, 0);
  const cutoff = new Date(bucket.valueOf() - 2 * 60 * 60 * 1000);
  // Bounded retention: preserve a small diagnostic window but never let a
  // frequently used credential accumulate minute rows indefinitely.
  await db.delete(externalConnectionRateLimitsTable).where(and(
    eq(externalConnectionRateLimitsTable.connectionId, connectionId),
    lt(externalConnectionRateLimitsTable.minuteBucket, cutoff),
  ));
  const result = await db.execute(sql`
    INSERT INTO ${externalConnectionRateLimitsTable} ("connection_id", "minute_bucket", "count")
    VALUES (${connectionId}::uuid, ${bucket.toISOString()}::timestamptz, 1)
    ON CONFLICT ("connection_id", "minute_bucket")
    DO UPDATE SET "count" = ${externalConnectionRateLimitsTable.count} + 1
    WHERE ${externalConnectionRateLimitsTable.count} < ${MAX_REQUESTS_PER_MINUTE}
    RETURNING ${externalConnectionRateLimitsTable.count}`);
  return result.rows.length === 1;
}

/** Live, deny-by-default credential check. It is intentionally invoked for every external operation. */
export async function authorizeExternalRequest(req: Request, transport: "rest" | "mcp", action: string): Promise<{ ok: true; context: ExternalConnectionContext } | { ok: false; status: number; error: string }> {
  const token = bearerFromRequest(req);
  if (!token) return { ok: false, status: 401, error: "Bearer authentication required" };
  const [row] = await db.select({
    connection: externalConnectionsTable,
    ownerActive: usersTable.isActive,
    ownerRole: usersTable.role,
  }).from(externalConnectionsTable).innerJoin(usersTable, and(
    eq(usersTable.id, externalConnectionsTable.createdByUserId),
    eq(usersTable.tenantId, externalConnectionsTable.tenantId),
  ))
    .where(eq(externalConnectionsTable.tokenHash, sha256(token))).limit(1);
  if (!row) return { ok: false, status: 401, error: "Invalid external credential" };
  const connection = row.connection;
  const context: ExternalConnectionContext = {
    id: connection.id, tenantId: connection.tenantId, createdByUserId: connection.createdByUserId, name: connection.name,
    mode: connection.mode as ExternalMode, provider: connection.provider as ExternalProvider,
    scopes: connection.scopes as ExternalScope[], allowWrites: connection.allowWrites, tokenHash: connection.tokenHash,
    webhookSecretEncrypted: connection.webhookSecretEncrypted,
  };
  const usableMode =
    connection.mode === "both" ||
    (transport === "rest" && connection.mode === "api") ||
    (transport === "mcp" && connection.mode === "mcp");
  if (!usableMode || !connection.enabled || connection.revokedAt || connection.expiresAt <= new Date() || !row.ownerActive || row.ownerRole !== "company_owner") {
    await appendExternalAudit(context, action, transport, "denied", requestId(req));
    return { ok: false, status: 403, error: "External connection is not active" };
  }
  if (!await consumeRateLimit(connection.id)) {
    await appendExternalAudit(context, action, transport, "denied", requestId(req));
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }
  await db.update(externalConnectionsTable).set({ lastUsedAt: new Date() }).where(eq(externalConnectionsTable.id, connection.id));
  return { ok: true, context };
}

/** Resolves only a live, owner-issued webhook connection identified by its opaque UUID path segment. */
export async function authorizeWebhookConnection(connectionId: string, provider: ExternalProvider, req: Request): Promise<{ ok: true; context: ExternalConnectionContext } | { ok: false; status: number; error: string }> {
  const [row] = await db.select({
    connection: externalConnectionsTable, ownerActive: usersTable.isActive, ownerRole: usersTable.role,
  }).from(externalConnectionsTable).innerJoin(usersTable, and(
    eq(usersTable.id, externalConnectionsTable.createdByUserId),
    eq(usersTable.tenantId, externalConnectionsTable.tenantId),
  ))
    .where(eq(externalConnectionsTable.id, connectionId)).limit(1);
  if (!row) return { ok: false, status: 404, error: "Webhook connection not found" };
  const connection = row.connection;
  const context: ExternalConnectionContext = {
    id: connection.id, tenantId: connection.tenantId, createdByUserId: connection.createdByUserId, name: connection.name,
    mode: connection.mode as ExternalMode, provider: connection.provider as ExternalProvider, scopes: connection.scopes as ExternalScope[],
    allowWrites: connection.allowWrites, tokenHash: connection.tokenHash, webhookSecretEncrypted: connection.webhookSecretEncrypted,
  };
  if (connection.provider !== provider || connection.mode !== "webhook" || !connection.enabled || connection.revokedAt || connection.expiresAt <= new Date() || !row.ownerActive || row.ownerRole !== "company_owner" || !connection.allowWrites || !context.scopes.includes("communications:ingest")) {
    await appendExternalAudit(context, "communications:webhook", "webhook", "denied", requestId(req));
    return { ok: false, status: 403, error: "Webhook connection is not active" };
  }
  return { ok: true, context };
}

/** Account only a provider delivery that has already passed its provider authentication. */
export async function accountAuthenticatedWebhookRequest(context: ExternalConnectionContext, req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!await consumeRateLimit(context.id)) {
    await appendExternalAudit(context, "communications:webhook", "webhook", "denied", requestId(req));
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }
  await db.update(externalConnectionsTable).set({ lastUsedAt: new Date() }).where(eq(externalConnectionsTable.id, context.id));
  return { ok: true };
}

export async function requireExternalScope(req: Request, context: ExternalConnectionContext, scope: ExternalScope, action: string, transport: "rest" | "mcp", write = false): Promise<boolean> {
  const allowed = context.scopes.includes(scope) && (!write || context.allowWrites);
  if (!allowed) await appendExternalAudit(context, action, transport, "denied", requestId(req));
  return allowed;
}

export function parseListQuery(query: unknown): { q?: string; limit: number; cursor: number | null } | null {
  const raw = query as Record<string, unknown>;
  const q = typeof raw.q === "string" ? raw.q.trim() : undefined;
  if (q && q.length > 100) return null;
  const limit = raw.limit == null ? 50 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) return null;
  let cursor: number | null = null;
  if (raw.cursor != null) {
    if (typeof raw.cursor !== "string" || !/^[1-9]\d*$/.test(raw.cursor)) return null;
    cursor = Number(raw.cursor);
  }
  return { q, limit, cursor };
}
function page<T extends { id: number }>(rows: T[], limit: number) {
  const trimmed = rows.slice(0, limit);
  return { data: trimmed, nextCursor: rows.length > limit ? String(trimmed.at(-1)?.id) : null };
}

export async function listExternalResource(context: ExternalConnectionContext, resource: string, query: { q?: string; limit: number; cursor: number | null }) {
  const cursor = query.cursor ? lt : undefined;
  const more = query.limit + 1;
  if (resource === "customers") {
    let where = and(eq(customersTable.tenantId, context.tenantId), query.cursor ? lt(customersTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, ilike(customersTable.name, `%${query.q}%`));
    const rows = await db.select().from(customersTable).where(where).orderBy(desc(customersTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, name: x.name, company: x.company ?? null, status: x.archivedAt ? "archived" : "active", createdAt: x.createdAt.toISOString(), ...(context.scopes.includes("customers:contact") ? { email: x.email, phone: x.phone, secondaryPhone: x.secondaryPhone ?? null } : {}) })), query.limit);
  }
  if (resource === "jobs") {
    let where = and(eq(jobsTable.tenantId, context.tenantId), query.cursor ? lt(jobsTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, ilike(jobsTable.title, `%${query.q}%`));
    const rows = await db.select().from(jobsTable).where(where).orderBy(desc(jobsTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, title: x.title, status: x.status, priority: x.priority, customerId: x.customerId ?? null, propertyId: x.propertyId ?? null, scheduledAt: x.scheduledAt.toISOString(), estimatedDuration: x.estimatedDuration ?? null, completedAt: x.completedAt?.toISOString() ?? null })), query.limit);
  }
  if (resource === "equipment") {
    let where = and(eq(equipmentTable.tenantId, context.tenantId), query.cursor ? lt(equipmentTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, ilike(equipmentTable.name, `%${query.q}%`));
    const rows = await db.select().from(equipmentTable).where(where).orderBy(desc(equipmentTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, name: x.name, type: x.type, model: x.model ?? null, serialNumber: x.serialNumber ?? null, year: x.year ?? null, isActive: x.isActive, assignedUserId: x.assignedUserId ?? null, assignedCrewId: x.assignedCrewId ?? null })), query.limit);
  }
  if (resource === "invoices") {
    let where = and(eq(invoicesTable.tenantId, context.tenantId), query.cursor ? lt(invoicesTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, ilike(invoicesTable.invoiceNumber, `%${query.q}%`));
    const rows = await db.select().from(invoicesTable).where(where).orderBy(desc(invoicesTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, invoiceNumber: x.invoiceNumber, customerId: x.customerId, status: x.status, total: x.total, balance: x.status === "paid" ? 0 : x.total, dueDate: x.dueDate?.toISOString() ?? null, createdAt: x.createdAt.toISOString() })), query.limit);
  }
  if (resource === "tasks") {
    let where = and(eq(internalTasksTable.tenantId, context.tenantId), query.cursor ? lt(internalTasksTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, ilike(internalTasksTable.title, `%${query.q}%`));
    const rows = await db.select().from(internalTasksTable).where(where).orderBy(desc(internalTasksTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, title: x.title, description: x.description ?? null, taskType: x.taskType ?? null, status: x.status, priority: x.priority, dueDate: x.dueDate ?? null, contextType: x.contextType ?? null, contextId: x.contextId ?? null, createdAt: x.createdAt.toISOString() })), query.limit);
  }
  if (resource === "communications") {
    let where = and(eq(communicationsLogTable.tenantId, context.tenantId), query.cursor ? lt(communicationsLogTable.id, query.cursor) : undefined);
    if (query.q) where = and(where, or(ilike(communicationsLogTable.fromAddress, `%${query.q}%`), ilike(communicationsLogTable.toAddress, `%${query.q}%`)));
    const rows = await db.select().from(communicationsLogTable).where(where).orderBy(desc(communicationsLogTable.id)).limit(more);
    return page(rows.map((x) => ({ id: x.id, direction: x.direction, channel: x.channel, from: x.fromAddress ?? null, to: x.toAddress ?? null, status: x.status, externalId: x.externalId ?? null, messageType: x.messageType, jobId: x.jobId ?? null, createdAt: x.createdAt.toISOString(), ...(context.scopes.includes("communications:content") ? { body: x.body, subject: x.subject ?? null } : {}) })), query.limit);
  }
  return null;
}

export function validateTaskInput(input: unknown): { title: string; description?: string; customerId?: number } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 180) return null;
  if (raw.description != null && (typeof raw.description !== "string" || raw.description.length > 4000)) return null;
  if (raw.customerId != null && (!Number.isSafeInteger(raw.customerId) || (raw.customerId as number) < 1)) return null;
  return { title: raw.title.trim(), ...(typeof raw.description === "string" ? { description: raw.description } : {}), ...(typeof raw.customerId === "number" ? { customerId: raw.customerId } : {}) };
}
export function validateVoipEvent(input: unknown): NormalizedVoipEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const small = (key: string, max: number) => typeof raw[key] === "string" && raw[key].length > 0 && raw[key].length <= max;
  if (!small("eventId", 256) || !small("from", 200) || !small("to", 200) || !small("status", 120) || raw.type !== "call" && raw.type !== "sms" || raw.direction !== "inbound" && raw.direction !== "outbound" || typeof raw.occurredAt !== "string" || Number.isNaN(new Date(raw.occurredAt).valueOf())) return null;
  if (raw.durationSeconds != null && (!Number.isInteger(raw.durationSeconds) || (raw.durationSeconds as number) < 0 || (raw.durationSeconds as number) > 172800)) return null;
  if (raw.body != null && (typeof raw.body !== "string" || raw.body.length > 8000)) return null;
  return { eventId: raw.eventId as string, type: raw.type, direction: raw.direction, from: raw.from as string, to: raw.to as string, occurredAt: raw.occurredAt as string, status: raw.status as string, ...(typeof raw.durationSeconds === "number" ? { durationSeconds: raw.durationSeconds } : {}), ...(typeof raw.body === "string" ? { body: raw.body } : {}) };
}

/** Keeps provider-supplied IDs out of the constrained idempotency-key syntax. */
export function providerEventIdempotencyKey(provider: ExternalProvider, eventId: string): string {
  return `provider:${sha256(`${provider}\u0000${eventId}`)}`;
}

async function reserveIdempotency(context: ExternalConnectionContext, action: string, key: string, payload: unknown) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(key)) return { kind: "invalid" as const };
  const fingerprint = sha256(canonical(payload));
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(externalWriteIdempotencyTable).values({ connectionId: context.id, action, idempotencyKey: key, fingerprint }).onConflictDoNothing().returning({ resourceId: externalWriteIdempotencyTable.resourceId });
    if (inserted.length) return { kind: "new" as const, fingerprint };
    const [previous] = await tx.select().from(externalWriteIdempotencyTable).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, action), eq(externalWriteIdempotencyTable.idempotencyKey, key))).limit(1);
    return previous?.fingerprint === fingerprint ? { kind: "replay" as const, resourceId: previous.resourceId } : { kind: "conflict" as const };
  });
}
async function setIdempotencyResource(context: ExternalConnectionContext, action: string, key: string, resourceId: number) {
  await db.update(externalWriteIdempotencyTable).set({ resourceId }).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, action), eq(externalWriteIdempotencyTable.idempotencyKey, key)));
}

export async function createExternalTask(context: ExternalConnectionContext, input: { title: string; description?: string; customerId?: number }, idempotencyKey: string) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) return { kind: "invalid" as const };
  const fingerprint = sha256(canonical(input));
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(externalWriteIdempotencyTable).values({
      connectionId: context.id, action: "tasks:create", idempotencyKey, fingerprint,
    }).onConflictDoNothing().returning({ resourceId: externalWriteIdempotencyTable.resourceId });
    if (!inserted.length) {
      const [previous] = await tx.select().from(externalWriteIdempotencyTable).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, "tasks:create"), eq(externalWriteIdempotencyTable.idempotencyKey, idempotencyKey))).limit(1);
      if (!previous || previous.fingerprint !== fingerprint) return { kind: "conflict" as const };
      const [task] = previous.resourceId ? await tx.select().from(internalTasksTable).where(and(eq(internalTasksTable.id, previous.resourceId), eq(internalTasksTable.tenantId, context.tenantId))).limit(1) : [];
      return task ? { kind: "replay" as const, task } : { kind: "conflict" as const };
    }
    if (input.customerId) {
      const [customer] = await tx.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, input.customerId), eq(customersTable.tenantId, context.tenantId))).limit(1);
      if (!customer) return { kind: "customer_missing" as const };
    }
    const [task] = await tx.insert(internalTasksTable).values({
      tenantId: context.tenantId, title: input.title, description: input.description ?? null, taskType: "follow_up",
      createdById: context.createdByUserId, assignedToRole: "admin_office", contextType: input.customerId ? "customer" : null, contextId: input.customerId ?? null,
    }).returning();
    await tx.update(externalWriteIdempotencyTable).set({ resourceId: task.id }).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, "tasks:create"), eq(externalWriteIdempotencyTable.idempotencyKey, idempotencyKey)));
    return { kind: "created" as const, task };
  });
}

export async function ingestExternalCommunication(context: ExternalConnectionContext, provider: ExternalProvider, event: NormalizedVoipEvent, idempotencyKey: string) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) return { kind: "invalid" as const };
  const fingerprint = sha256(canonical({ provider, event }));
  return db.transaction(async (tx) => {
    // Serialize duplicate provider deliveries before creating a communications row.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.id}:${provider}:${event.eventId}`}))`);
    const inserted = await tx.insert(externalWriteIdempotencyTable).values({
      connectionId: context.id, action: "communications:ingest", idempotencyKey, fingerprint,
    }).onConflictDoNothing().returning({ resourceId: externalWriteIdempotencyTable.resourceId });
    if (!inserted.length) {
      const [previous] = await tx.select().from(externalWriteIdempotencyTable).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, "communications:ingest"), eq(externalWriteIdempotencyTable.idempotencyKey, idempotencyKey))).limit(1);
      if (!previous || previous.fingerprint !== fingerprint) return { kind: "conflict" as const };
      const [message] = previous.resourceId ? await tx.select().from(communicationsLogTable).where(and(eq(communicationsLogTable.id, previous.resourceId), eq(communicationsLogTable.tenantId, context.tenantId))).limit(1) : [];
      return message ? { kind: "replay" as const, message } : { kind: "conflict" as const };
    }
    const [prior] = await tx.select().from(externalVoipEventsTable).where(and(eq(externalVoipEventsTable.connectionId, context.id), eq(externalVoipEventsTable.provider, provider), eq(externalVoipEventsTable.eventId, event.eventId))).limit(1);
    if (prior) {
      await tx.update(externalWriteIdempotencyTable).set({ resourceId: prior.communicationsLogId }).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, "communications:ingest"), eq(externalWriteIdempotencyTable.idempotencyKey, idempotencyKey)));
      const [message] = await tx.select().from(communicationsLogTable).where(eq(communicationsLogTable.id, prior.communicationsLogId)).limit(1);
      return message ? { kind: "replay" as const, message } : { kind: "conflict" as const };
    }
    const lookupAddress = event.direction === "inbound" ? event.from : event.to;
    const [customer] = await tx.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.tenantId, context.tenantId), or(eq(customersTable.phone, lookupAddress), eq(customersTable.secondaryPhone, lookupAddress)))).limit(1);
    const [message] = await tx.insert(communicationsLogTable).values({
      tenantId: context.tenantId, customerId: customer?.id ?? null, direction: event.direction, channel: event.type,
      fromAddress: event.from, toAddress: event.to, body: event.body ?? "", status: event.status,
      externalId: `${provider}:${event.eventId}`, messageType: "external_import", createdAt: new Date(event.occurredAt),
    }).returning();
    await tx.insert(externalVoipEventsTable).values({ connectionId: context.id, provider, eventId: event.eventId, communicationsLogId: message.id });
    await tx.update(externalWriteIdempotencyTable).set({ resourceId: message.id }).where(and(eq(externalWriteIdempotencyTable.connectionId, context.id), eq(externalWriteIdempotencyTable.action, "communications:ingest"), eq(externalWriteIdempotencyTable.idempotencyKey, idempotencyKey)));
    return { kind: "created" as const, message };
  });
}