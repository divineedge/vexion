import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const mocks = vi.hoisted(() => ({
  authorizeExternalRequest: vi.fn(),
  requireExternalScope: vi.fn(),
  listExternalResource: vi.fn(),
  createExternalTask: vi.fn(),
  ingestExternalCommunication: vi.fn(),
}));

vi.mock("../lib/externalAccess", () => ({
  authorizeExternalRequest: mocks.authorizeExternalRequest,
  requireExternalScope: mocks.requireExternalScope,
  listExternalResource: mocks.listExternalResource,
  createExternalTask: mocks.createExternalTask,
  ingestExternalCommunication: mocks.ingestExternalCommunication,
  parseListQuery: (input: { q?: string; limit?: number; cursor?: string }) => ({ q: input.q, limit: input.limit ?? 50, cursor: input.cursor ? Number(input.cursor) : null }),
  validateTaskInput: (value: unknown) => value,
  validateVoipEvent: (value: unknown) => value,
}));

import externalMcpRouter from "./externalMcp";

const context = {
  id: "connection-1", tenantId: 7, createdByUserId: 4, name: "Assistant",
  mode: "mcp" as const, provider: "generic" as const, scopes: ["customers:read", "tasks:create"] as const,
  allowWrites: true, tokenHash: "hash", webhookSecretEncrypted: null,
};
const headers = { Authorization: "Bearer redacted-test-token", Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } };

function app() {
  const server = express();
  server.use(express.json());
  server.use(externalMcpRouter);
  return server;
}
async function rpc(payload: object) {
  return request(app()).post("/external/mcp").set(headers).send(payload);
}

describe("external MCP stateless permission parity", () => {
  let close: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    close = vi.spyOn(StreamableHTTPServerTransport.prototype, "close");
    mocks.authorizeExternalRequest.mockResolvedValue({ ok: true, context });
    mocks.requireExternalScope.mockResolvedValue(true);
    mocks.listExternalResource.mockResolvedValue({ data: [{ id: 1, name: "Safe customer" }], nextCursor: null });
    mocks.createExternalTask.mockResolvedValue({ kind: "created", task: { id: 9, title: "Follow up", status: "open" } });
  });
  afterEach(() => close.mockRestore());

  it("serves initialize and a per-request tools/list containing only currently allowed tools", async () => {
    const init = await rpc(initialize);
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("divine-edge-external");
    const tools = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(tools.status).toBe(200);
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_customers", "create_followup_task"]));
    expect(names).not.toContain("list_invoices");
    expect(names).not.toContain("ingest_communication");
    expect(close).toHaveBeenCalled();
  });

  it("rechecks a tool call with shared authorization and refuses a scope revoked after tools/list", async () => {
    const deniedContext = { ...context, scopes: ["customers:read"] };
    mocks.authorizeExternalRequest.mockResolvedValueOnce({ ok: true, context }).mockResolvedValueOnce({ ok: true, context: deniedContext });
    mocks.requireExternalScope.mockResolvedValue(false);
    const response = await rpc({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "create_followup_task", arguments: { title: "Follow up", idempotencyKey: "idempotency-1" } },
    });
    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBe(true);
    expect(mocks.createExternalTask).not.toHaveBeenCalled();
  });

  it("uses the same allowed create service and rejects untrusted browser origins", async () => {
    const created = await rpc({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "create_followup_task", arguments: { title: "Follow up", idempotencyKey: "idempotency-2" } },
    });
    expect(created.status).toBe(200);
    expect(mocks.createExternalTask).toHaveBeenCalledWith(context, { title: "Follow up" }, "idempotency-2");
    const authorizationCalls = mocks.authorizeExternalRequest.mock.calls.length;
    const browser = await request(app()).post("/external/mcp").set({ ...headers, Origin: "https://untrusted.example" }).send(initialize);
    expect(browser.status).toBe(403);
    expect(mocks.authorizeExternalRequest).toHaveBeenCalledTimes(authorizationCalls);
  });
});