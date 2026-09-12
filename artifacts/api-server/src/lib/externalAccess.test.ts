import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authRow: null as Record<string, unknown> | null,
  listRows: [] as Record<string, unknown>[],
  txSelectQueue: [] as Record<string, unknown>[][],
  idempotencyInsert: [] as Record<string, unknown>[],
  insertedTasks: [] as Record<string, unknown>[],
  idempotencyValues: [] as Record<string, unknown>[],
  taskValues: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values, desc: (value: unknown) => value, eq: (...values: unknown[]) => values,
  gt: (...values: unknown[]) => values, ilike: (...values: unknown[]) => values, lt: (...values: unknown[]) => values,
  or: (...values: unknown[]) => values, sql: () => ({}),
}));
vi.mock("@workspace/db", () => {
  const table = (columns: string[]) => Object.fromEntries(columns.map((column) => [column, column]));
  const externalConnectionsTable = table(["id", "tenantId", "createdByUserId", "name", "mode", "provider", "scopes", "allowWrites", "enabled", "expiresAt", "revokedAt", "tokenHash", "webhookSecretEncrypted", "lastUsedAt"]);
  const externalWriteIdempotencyTable = table(["connectionId", "action", "idempotencyKey", "fingerprint", "resourceId"]);
  const internalTasksTable = table(["id", "tenantId"]);
  const customersTable = table(["id", "tenantId", "name", "archivedAt", "email", "phone", "secondaryPhone", "company", "createdAt"]);
  const communicationsLogTable = table(["id", "tenantId", "fromAddress", "toAddress", "direction", "channel", "status", "externalId", "messageType", "jobId", "createdAt", "body", "subject"]);
  const select = vi.fn(() => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ limit: async () => state.authRow ? [state.authRow] : [] }) }),
      where: () => ({ orderBy: () => ({ limit: async () => state.listRows }) }),
    }),
  }));
  const transaction = async <T>(work: (tx: any) => Promise<T>): Promise<T> => work(tx);
  const tx = {
    insert: (target: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (target === externalWriteIdempotencyTable) {
          state.idempotencyValues.push(values);
          return { onConflictDoNothing: () => ({ returning: async () => state.idempotencyInsert }) };
        }
        if (target === internalTasksTable) {
          state.taskValues.push(values);
          return { returning: async () => state.insertedTasks };
        }
        return { onConflictDoNothing: () => ({ returning: async () => [] }), returning: async () => [] };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.txSelectQueue.shift() ?? [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    execute: async () => ({ rows: [{ count: 1 }] }),
  };
  return {
    communicationsLogTable, customersTable, db: { select, execute: async () => ({ rows: [{ count: 1 }] }), delete: () => ({ where: async () => undefined }), update: () => ({ set: () => ({ where: async () => undefined }) }), insert: () => ({ values: async () => undefined }), transaction },
    equipmentTable: table(["id", "tenantId", "name"]), externalAccessAuditTable: table(["tenantId", "connectionId", "connectionName", "action", "transport", "status", "requestId"]),
    externalConnectionRateLimitsTable: table(["connectionId", "minuteBucket", "count"]), externalConnectionsTable,
    externalVoipEventsTable: table(["connectionId", "provider", "eventId", "communicationsLogId"]), externalWriteIdempotencyTable,
    internalTasksTable, invoicesTable: table(["id", "tenantId", "invoiceNumber"]), jobsTable: table(["id", "tenantId", "title"]), usersTable: table(["id", "isActive", "role"]),
  };
});

import { authorizeExternalRequest, createExternalTask, listExternalResource, providerEventIdempotencyKey, validateConnectionInput, validateVoipEvent } from "./externalAccess";

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: "conn-1", tenantId: 7, createdByUserId: 4, name: "Test service", mode: "api", provider: "generic",
  scopes: ["customers:read", "communications:read"], allowWrites: false, enabled: true,
  expiresAt: new Date(Date.now() + 60_000), revokedAt: null, tokenHash: crypto.createHash("sha256").update("eac_test_token_1234567890").digest("hex"),
  webhookSecretEncrypted: null, ...overrides,
});
const request = { header: (name: string) => name === "authorization" ? "Bearer eac_test_token_1234567890" : undefined, id: "request-1" } as never;

describe("external access shared authorization and serialization", () => {
  beforeEach(() => {
    state.authRow = { connection: connection(), ownerActive: true, ownerRole: "company_owner" };
    state.listRows = []; state.txSelectQueue = []; state.idempotencyInsert = [];
    state.insertedTasks = [{ id: 88, tenantId: 7, title: "Follow up", status: "open" }];
    state.idempotencyValues = []; state.taskValues = [];
  });

  it("ignores caller tenant headers and rejects inactive owner, non-owner, expiration, pause, revoke, and wrong transport", async () => {
    const allowed = await authorizeExternalRequest({ ...(request as object), headers: { "x-tenant-id": "999" } } as never, "rest", "list:customers");
    expect(allowed.ok && allowed.context.tenantId).toBe(7);
    state.authRow = { connection: connection({ mode: "mcp" }), ownerActive: true, ownerRole: "company_owner" };
    expect((await authorizeExternalRequest(request, "mcp", "tools/list")).ok).toBe(true);
    for (const overrides of [
      { ownerActive: false }, { ownerRole: "office_manager" }, { connection: connection({ expiresAt: new Date(Date.now() - 1) }) },
      { connection: connection({ enabled: false }) }, { connection: connection({ revokedAt: new Date() }) }, { connection: connection({ mode: "mcp" }) },
    ]) {
      state.authRow = { connection: connection(), ownerActive: true, ownerRole: "company_owner", ...overrides };
      const result = await authorizeExternalRequest(request, "rest", "test");
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("redacts customer contact data and communications content unless the dependent scope is present", async () => {
    state.listRows = [{ id: 2, tenantId: 7, name: "Customer", company: "Co", archivedAt: null, email: "private@example.test", phone: "+15550001", secondaryPhone: null, createdAt: new Date() }];
    const base = connection({ scopes: ["customers:read"] });
    const basic = await listExternalResource(base as never, "customers", { limit: 10, cursor: null });
    expect(basic?.data[0]).not.toHaveProperty("email");
    const contact = await listExternalResource(connection({ scopes: ["customers:read", "customers:contact"] }) as never, "customers", { limit: 10, cursor: null });
    expect(contact?.data[0]).toMatchObject({ email: "private@example.test", phone: "+15550001" });
    state.listRows = [{ id: 3, tenantId: 7, direction: "inbound", channel: "sms", fromAddress: "+15550001", toAddress: "+15550002", status: "received", externalId: "x", messageType: "manual", jobId: null, createdAt: new Date(), body: "private message", subject: "private" }];
    const metadata = await listExternalResource(connection({ scopes: ["communications:read"] }) as never, "communications", { limit: 10, cursor: null });
    expect(metadata?.data[0]).not.toHaveProperty("body");
    const content = await listExternalResource(connection({ scopes: ["communications:read", "communications:content"] }) as never, "communications", { limit: 10, cursor: null });
    expect(content?.data[0]).toMatchObject({ body: "private message", subject: "private" });
  });

  it("rejects scope escalation and provider/mode combinations before a connection is persisted", () => {
    expect(validateConnectionInput({ name: "x", mode: "api", provider: "generic", scopes: ["customers:contact"], allowWrites: false, expiresAt: new Date(Date.now() + 60_000).toISOString(), riskAcknowledged: true }).ok).toBe(false);
    expect(validateConnectionInput({ name: "x", mode: "api", provider: "generic", scopes: ["tasks:create"], allowWrites: false, expiresAt: new Date(Date.now() + 60_000).toISOString(), riskAcknowledged: true }).ok).toBe(false);
    expect(validateConnectionInput({ name: "x", mode: "api", provider: "quo", scopes: [], allowWrites: false, expiresAt: new Date(Date.now() + 60_000).toISOString(), riskAcknowledged: true }).ok).toBe(false);
  });

  it("uses a fingerprinted connection-scoped idempotency reservation and server tenant for follow-up tasks", async () => {
    state.idempotencyInsert = [{}];
    state.txSelectQueue = [[{ id: 14 }]];
    const created = await createExternalTask(connection({ allowWrites: true, scopes: ["tasks:create"] }) as never, { title: "Follow up", customerId: 14 }, "same-key");
    expect(created.kind).toBe("created");
    expect(state.taskValues[0]).toMatchObject({ tenantId: 7, createdById: 4, contextId: 14 });
    const fingerprint = crypto.createHash("sha256").update('{"customerId":14,"title":"Follow up"}').digest("hex");
    state.idempotencyInsert = [];
    state.txSelectQueue = [[{ fingerprint, resourceId: 88 }], state.insertedTasks];
    const replay = await createExternalTask(connection({ allowWrites: true, scopes: ["tasks:create"] }) as never, { title: "Follow up", customerId: 14 }, "same-key");
    expect(replay.kind).toBe("replay");
    state.txSelectQueue = [[{ fingerprint: "different", resourceId: 88 }]];
    const conflict = await createExternalTask(connection({ allowWrites: true, scopes: ["tasks:create"] }) as never, { title: "Changed", customerId: 14 }, "same-key");
    expect(conflict.kind).toBe("conflict");
  });

  it("accepts adapter-length provider IDs while producing a safe fixed idempotency key", () => {
    const eventId = "provider/⚠️/" + "!".repeat(240);
    const event = validateVoipEvent({ eventId, type: "sms", direction: "inbound", from: "+15550001", to: "+15550002", occurredAt: "2025-01-01T00:00:00.000Z", status: "received" });
    expect(event?.eventId).toBe(eventId);
    expect(providerEventIdempotencyKey("ringcentral", eventId)).toMatch(/^provider:[a-f0-9]{64}$/);
  });
});