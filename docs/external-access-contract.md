# External API, MCP, and VoIP access

Implementation contract for owner-managed third-party access. All endpoints below
are relative to the existing `/api` mount. Staff sessions and external credentials
are separate authentication boundaries.

## Management API (verified staff session, company owner only)

- `GET /external-access/catalog`: `{ permissions, presets }`.
  Permissions: `{ id, label, description, sensitive, write }`.
  Presets: `{ id, label, description, scopes, mode, provider }`.
- `GET /external-access/connections`: array of Connection.
- `POST /external-access/connections`: ConnectionInput; returns `{ connection, token }`.
- `PATCH /external-access/connections/:id`: partial ConnectionInput; returns Connection.
- `POST /external-access/connections/:id/rotate`: returns `{ connection, token }`.
- `POST /external-access/connections/:id/revoke`: returns Connection.
- `PUT /external-access/connections/:id/webhook-secret`: `{ secret: string }`;
  stores a Quo signing secret encrypted server-side; returns Connection, never secret.
- `GET /external-access/audit?connectionId=&limit=`: array of
  `{ id, connectionId, connectionName, action, transport, status, requestId, createdAt }`.

Connection: `{ id: string, name: string, description: string, mode, provider,
scopes: string[], allowWrites: boolean, enabled: boolean, expiresAt: string,
revokedAt: string|null, lastUsedAt: string|null, createdAt: string, tokenPrefix: string,
webhookSecretConfigured: boolean }`.

ConnectionInput: `{ name, description?, mode, provider, scopes, allowWrites?,
expiresAt, riskAcknowledged: boolean }`.
Modes: `api | mcp | both | webhook`. Providers: `generic | quo | ringcentral`.
No raw secret is ever included in list/detail/audit. Tokens are shown only on
creation or rotation, held only in component memory, and stored hashed by the API.
Maximum expiry is one year. Revocation is irreversible; enabled supports pausing.
Acknowledgment is mandatory on creation and permission/write-access edits.

## Permissions

- `customers:read`: basic customer identity and status (no contact details/notes).
- `customers:contact`: contact details, requires customers:read.
- `jobs:read`: basic scheduling/status information (no notes, costs, access codes).
- `equipment:read`: basic tenant equipment (no costs, history or private notes).
- `invoices:read`: invoice balances/status, explicitly sensitive.
- `tasks:read`: follow-up tasks, explicitly sensitive because they contain free text.
- `tasks:create`: create office follow-up tasks; requires allowWrites.
- `communications:read`: call/SMS metadata; explicitly sensitive contact information.
- `communications:content`: message text, requires communications:read.
- `communications:ingest`: import call/SMS events; requires allowWrites.

No credential, payment method, access code, password, session, arbitrary URL fetch,
SQL execution, delete, payment, or outbound call/message capability is exposed.
Selected categories are tenant-wide; the UI must say this explicitly.

## External REST API

Opaque bearer token, checked against live connection on each request; no staff
session authentication, no caller-selected tenant IDs, bounded pagination,
per-connection rate limits, safe allowlisted DTOs, append-only metadata-only audit.

- `GET /external/v1/me`: current connection metadata/permissions.
- `GET /external/v1/{customers,jobs,equipment,invoices,tasks,communications}`:
  query `{ q?, limit?, cursor? }`; returns `{ data: object[], nextCursor: string|null }`.
- `POST /external/v1/tasks`: `{ title, description?, customerId? }`.
- `POST /external/v1/communications`: normalized VoIP event, below.
- `GET /external/v1/openapi.json`: documented external API for authorized clients.
- Writes require `Idempotency-Key`; same key plus changed payload is a conflict.

## MCP

`POST /external/mcp`: official SDK stateless Streamable HTTP, bearer credentials.
Expose only the permitted tools, using the exact same authorization/serializers
as REST. Every tools/call must recheck permissions; do not rely on tools/list.
Tools cover permitted list/lookups, create follow-up task, ingest communication.
MCP writes accept an explicit idempotencyKey argument.
Document that clients must support bearer headers; OAuth-only client setup is not
implemented by this contract and must not be advertised as working.

## VoIP

`POST /external/webhooks/:id/:provider`, mode=webhook, matching provider, current
connection, communications:ingest and allowWrites required before any data write.
Quo verifies provider HMAC/signature over raw body; signing secret supplied through
owner settings. RingCentral sends its configured `deliveryMode.validationToken`
as `Validation-Token` on events; verify that header against the connection token
hash. Echo a bounded Validation-Token only for an empty-body setup handshake
without recording an event. An event body with this header is NOT a handshake.
No token in URLs.
Generic providers use bearer-authenticated REST normalized event ingestion.

NormalizedVoipEvent: `{ eventId: string, type: "call"|"sms",
direction: "inbound"|"outbound", from: string, to: string,
occurredAt: string, status: string, durationSeconds?: number, body?: string }`.
Deduplicate by connection + provider event ID. Validate bounded inputs, accept only
supported event types, never fetch provider-supplied URLs, never store recordings
or transcripts. Imported events must appear in the existing communications UI.

## Warning and setup requirements

Warn that third parties receive data outside this app, may retain copied data,
and may act on incorrect AI output. Revoking access stops future requests but
cannot retrieve data already shared. Recommend one connection per service,
minimum permissions, short expirations, and trusted assistants only.
Changing scopes affects both REST and MCP immediately. Owner may pause/revoke at
any time and inspect successful/denied activity without exposed payloads/tokens.
Do not create real provider subscriptions, send messages, or connect live accounts
during implementation/testing. Use a verified published URL in setup examples,
with a visible development-preview warning when using a workspace URL.