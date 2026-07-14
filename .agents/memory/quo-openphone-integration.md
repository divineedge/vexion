---
name: Quo (quo.com) API integration
description: Quo is OpenPhone's 2026 rebrand — same underlying API/data model, but a different, stricter webhook signing scheme. Read this before wiring up Quo or debugging OpenPhone-vs-Quo webhook signature failures.
---

Quo (quo.com) is OpenPhone's rebrand. Its public REST API (`https://api.quo.com`, `Authorization: <apiKey>` header, not Bearer) mirrors OpenPhone's calls/messages/contacts/conversations resources closely enough that shared payload-shape assumptions (e.g. `type` + `data.object` on webhook bodies) can be reused across both providers.

**Why this matters:** treating Quo as "just another SMS platform" and copying the old OpenPhone `X-OpenPhone-Signature: sha256=<hex>` verification scheme silently fails — Quo webhooks use a different, svix-compatible scheme:
- Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature` (space-separated `v1,<base64>` entries).
- Signing key returned as `whsec_...`; strip the prefix and base64-decode the remainder to get raw HMAC key bytes.
- Signature = HMAC-SHA256 over `${webhookId}.${webhookTimestamp}.${rawBody}`, base64-encoded.
- Reject deliveries whose timestamp is >5 minutes from server time (replay protection) — this is part of Quo's documented contract, not optional hardening.

**How to apply:** verify Quo webhooks with this scheme (see `verifyQuoSignature` in `artifacts/api-server/src/lib/quoClient.ts`) while keeping the existing OpenPhone/Twilio branches untouched — they remain valid for tenants still on those platforms. Call/message field extraction logic downstream of signature verification can stay provider-agnostic since Quo's payload shape matches OpenPhone's.

Quo API docs: https://www.quo.com/docs (fetch `/docs/llms.txt` for the full endpoint index — covers calls, messages, contacts, conversations, webhooks).
