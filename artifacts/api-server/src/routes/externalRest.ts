import { Router, type IRouter } from "express";
import {
  appendExternalAudit, authorizeExternalRequest, createExternalTask, ingestExternalCommunication, listExternalResource,
  parseListQuery, requireExternalScope, validateTaskInput, validateVoipEvent,
} from "../lib/externalAccess";
import { externalOpenApiDocument } from "../lib/externalOpenApi";

const router: IRouter = Router();
const resourceScopes = {
  customers: "customers:read", jobs: "jobs:read", equipment: "equipment:read", invoices: "invoices:read",
  tasks: "tasks:read", communications: "communications:read",
} as const;

router.get("/external/v1/openapi.json", async (req, res): Promise<void> => {
  const auth = await authorizeExternalRequest(req, "rest", "openapi");
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  await appendExternalAudit(auth.context, "openapi", "rest", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.json(externalOpenApiDocument);
});
router.get("/external/v1/me", async (req, res): Promise<void> => {
  const auth = await authorizeExternalRequest(req, "rest", "me");
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  await appendExternalAudit(auth.context, "me", "rest", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.json({ id: auth.context.id, name: auth.context.name, mode: auth.context.mode, provider: auth.context.provider, scopes: auth.context.scopes, allowWrites: auth.context.allowWrites });
});
router.get("/external/v1/:resource", async (req, res): Promise<void> => {
  const resource = Array.isArray(req.params.resource) ? req.params.resource[0] : req.params.resource;
  const auth = await authorizeExternalRequest(req, "rest", `list:${resource}`);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const scope = resourceScopes[resource as keyof typeof resourceScopes];
  if (!scope || !await requireExternalScope(req, auth.context, scope, `list:${resource}`, "rest")) { res.status(403).json({ error: "Permission denied" }); return; }
  const query = parseListQuery(req.query);
  if (!query) { await appendExternalAudit(auth.context, `list:${resource}`, "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid pagination query" }); return; }
  const result = await listExternalResource(auth.context, resource, query);
  if (!result) { await appendExternalAudit(auth.context, `list:${resource}`, "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(404).json({ error: "Resource not found" }); return; }
  await appendExternalAudit(auth.context, `list:${resource}`, "rest", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.json(result);
});
router.post("/external/v1/tasks", async (req, res): Promise<void> => {
  const auth = await authorizeExternalRequest(req, "rest", "tasks:create");
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (!await requireExternalScope(req, auth.context, "tasks:create", "tasks:create", "rest", true)) { res.status(403).json({ error: "Permission denied" }); return; }
  const key = req.header("idempotency-key");
  const input = validateTaskInput(req.body);
  if (!key) { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Idempotency-Key is required" }); return; }
  if (!input) { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid follow-up task input" }); return; }
  const result = await createExternalTask(auth.context, input, key);
  if (result.kind === "invalid") { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid Idempotency-Key" }); return; }
  if (result.kind === "conflict") { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(409).json({ error: "Idempotency-Key was used with a different request" }); return; }
  if (result.kind === "customer_missing") { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(404).json({ error: "Customer not found" }); return; }
  if (!("task" in result)) { await appendExternalAudit(auth.context, "tasks:create", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(409).json({ error: "Request is still being processed" }); return; }
  await appendExternalAudit(auth.context, "tasks:create", "rest", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.status(result.kind === "created" ? 201 : 200).json({ id: result.task.id, title: result.task.title, description: result.task.description ?? null, status: result.task.status, customerId: result.task.contextType === "customer" ? result.task.contextId : null });
});
router.post("/external/v1/communications", async (req, res): Promise<void> => {
  const auth = await authorizeExternalRequest(req, "rest", "communications:ingest");
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (!await requireExternalScope(req, auth.context, "communications:ingest", "communications:ingest", "rest", true)) { res.status(403).json({ error: "Permission denied" }); return; }
  const key = req.header("idempotency-key");
  const event = validateVoipEvent(req.body);
  if (!key) { await appendExternalAudit(auth.context, "communications:ingest", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Idempotency-Key is required" }); return; }
  if (!event) { await appendExternalAudit(auth.context, "communications:ingest", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid normalized communications event" }); return; }
  const result = await ingestExternalCommunication(auth.context, "generic", event, key);
  if (result.kind === "invalid") { await appendExternalAudit(auth.context, "communications:ingest", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(400).json({ error: "Invalid Idempotency-Key" }); return; }
  if (result.kind === "conflict") { await appendExternalAudit(auth.context, "communications:ingest", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(409).json({ error: "Idempotency-Key was used with a different request" }); return; }
  if (!("message" in result)) { await appendExternalAudit(auth.context, "communications:ingest", "rest", "denied", typeof req.id === "string" ? req.id : undefined); res.status(409).json({ error: "Request is still being processed" }); return; }
  await appendExternalAudit(auth.context, "communications:ingest", "rest", "allowed", typeof req.id === "string" ? req.id : undefined);
  res.status(result.kind === "created" ? 201 : 200).json({ id: result.message.id, status: result.message.status, externalId: result.message.externalId });
});

export default router;