# Connect outside software to Divine Edge

## Before connecting

Use **Settings → API & AI Access** while signed in as the company owner.
Create a separate connection for each assistant, phone service, or automation.
Do not share an employee password or staff session.

Select only the permissions needed. Permissions apply to the selected categories
across your business, not selected customers or crews. Customer contact details,
invoice balances, task text, and communication content are sensitive.

Third parties can retain data after receiving it. Pausing, rotating, or revoking
credentials prevents future access but cannot recall previously shared copies.
AI output can be incorrect. Treat text inside customer records or messages as
untrusted data, not instructions to the assistant.

Connections expire. Pause temporarily, rotate a compromised token, or permanently
revoke a connection you no longer need. Tokens are shown only when created or
rotated. Store them in the connecting service's secure credential settings.

## REST API

Use your **published** website origin, not a Replit development-preview address.
The base path is `/api/external/v1`. Provide:

```http
Authorization: Bearer YOUR_CONNECTION_TOKEN
```

Example (the environment variable is a placeholder for your securely stored token):

```bash
curl 'https://YOUR_PUBLISHED_DOMAIN/api/external/v1/me' \
  -H "Authorization: Bearer $DIVINE_EDGE_TOKEN"
```

The authenticated `/api/external/v1/openapi.json` endpoint describes supported
requests. The API supports bounded customer, job, equipment, invoice, task,
and communication lists according to the connection's permissions.

Allowed writes are office follow-up task creation and communication-event import.
Both require the relevant permission, explicit write access, and an
`Idempotency-Key` header. Retry with the same key and identical payload to avoid
creating duplicates. Reusing a key for a different payload is rejected.

There is no payment, deletion, outbound calling, or customer-message sending API
in this external-access release.

## MCP assistants

Use `/api/external/mcp` on your published origin with **Streamable HTTP** and the
same bearer Authorization header. Enable MCP or API + MCP on the connection.

The server advertises only allowed tools and checks authorization again when
tools run. The permission rules and data redaction are shared with REST.
Write tools require an explicit idempotency key.

Client configuration formats differ. Bearer connections require a remote
Streamable HTTP URL plus custom bearer headers. For clients requiring sign-in,
choose **OAuth MCP** when creating the connection, register the assistant's exact
HTTPS callback, and use its public client ID (no client secret). The owner must
then approve the requested permissions in the sign-in flow. See
[OAuth client setup](./external-oauth-client-setup.md) for documented provider
paths and verification limits. This is not an anonymous or legacy SSE endpoint.

## Quo / OpenPhone

1. Create a **Quo webhook** connection with `communications:ingest`, write access,
   an expiry, and the required warning acknowledgment.
2. Register the connection's copied webhook URL with Quo.
3. Save Quo's webhook signing secret in the connection's signing-secret setting.
   It is stored encrypted, never returned, and is separate from the issued API token.
4. Subscribe to `call.completed`, `message.received`, and/or `message.sent`.

Signed requests are checked against their original raw body and timestamp.
Events are deduplicated and imported into the existing communications history.
Recording URLs, recordings, and transcripts are not imported.

## RingCentral

1. Create a **RingCentral webhook** connection with `communications:ingest` and
   explicit write access.
2. Configure your RingCentral subscription's delivery address with the copied
   webhook URL.
3. Set `deliveryMode.validationToken` to the connection token shown at creation.
   RingCentral sends this value in the `Validation-Token` event header.
4. Use telephony-session events or instant inbound SMS notifications. The server
   handles the separate empty-body validation challenge during subscription setup.

Counter-only message-store change notifications contain no actual message and
are not imported. They would require a separate authenticated provider fetch.
This release does not create RingCentral subscriptions or renew them for you.

Official receiving-webhooks documentation:
https://developers.ringcentral.com/guide/notifications/webhooks/receiving

## Other VoIP services and automation tools

Use an API-mode connection and POST a normalized event to
`/api/external/v1/communications` with bearer authentication and an idempotency key:

```json
{
  "eventId": "unique-provider-event-id",
  "type": "call",
  "direction": "inbound",
  "from": "+15555550101",
  "to": "+15555550102",
  "occurredAt": "2026-09-12T15:00:00Z",
  "status": "completed",
  "durationSeconds": 60
}
```

For SMS, use `type: "sms"` and optional `body`. Never send provider API keys,
recordings, transcripts, or staff credentials in an event.
The provider or your automation tool must map its event format to this API;
not every VoIP service provides an identical webhook payload.

## Audit

The owner activity log shows connections and outcomes without recording raw
credentials or copied customer/message payloads. An empty log means no activity
has been recorded, not that a provider account has been connected successfully.