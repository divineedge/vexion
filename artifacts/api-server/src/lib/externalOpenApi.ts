/** A separately served, deliberately narrow contract for bearer-authenticated integrations. */
export const externalOpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "Divine Edge External API", version: "v1", description: "Owner-managed bearer-token API. Tokens never select a tenant. Writes require Idempotency-Key." },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Opaque owner-managed connection token" } },
    schemas: {
      Error: { type: "object", additionalProperties: false, required: ["error"], properties: { error: { type: "string" } } },
      Page: { type: "object", required: ["data", "nextCursor"], properties: { data: { type: "array", items: { type: "object" } }, nextCursor: { type: ["string", "null"] } } },
      FollowUpTaskInput: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 180 }, description: { type: "string", maxLength: 4000 }, customerId: { type: "integer", minimum: 1 } } },
      NormalizedVoipEvent: { type: "object", additionalProperties: false, required: ["eventId", "type", "direction", "from", "to", "occurredAt", "status"], properties: { eventId: { type: "string", maxLength: 256 }, type: { type: "string", enum: ["call", "sms"] }, direction: { type: "string", enum: ["inbound", "outbound"] }, from: { type: "string", maxLength: 200 }, to: { type: "string", maxLength: 200 }, occurredAt: { type: "string", format: "date-time" }, status: { type: "string", maxLength: 120 }, durationSeconds: { type: "integer", minimum: 0, maximum: 172800 }, body: { type: "string", maxLength: 8000 } } },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/external/v1/me": { get: { summary: "Current connection metadata", responses: { "200": { description: "Connection", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "Authentication failed" } } } },
    "/external/v1/{resource}": { get: { summary: "List a permitted resource", parameters: [{ name: "resource", in: "path", required: true, schema: { type: "string", enum: ["customers", "jobs", "equipment", "invoices", "tasks", "communications"] } }, { name: "q", in: "query", schema: { type: "string", maxLength: 100 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }, { name: "cursor", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Safe DTO page", content: { "application/json": { schema: { $ref: "#/components/schemas/Page" } } } } } } },
    "/external/v1/tasks": { post: { summary: "Create an office follow-up task", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", maxLength: 200 } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/FollowUpTaskInput" } } } }, responses: { "201": { description: "Created" }, "409": { description: "Idempotency conflict" } } } },
    "/external/v1/communications": { post: { summary: "Import a normalized call or SMS event", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", maxLength: 200 } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NormalizedVoipEvent" } } } }, responses: { "201": { description: "Imported" }, "409": { description: "Idempotency conflict" } } } },
  },
} as const;