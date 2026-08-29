---
name: Mobile message delivery
description: Reliability and pagination invariants for Field App staff messaging.
---

Mobile staff messages must be queued in a persistent outbox scoped by tenant, user, and conversation. Every queued message keeps a stable client-generated ID, and server writes deduplicate on tenant, sender, and that ID.

**Why:** Connectivity can fail after the server commits but before the client receives the response. Retrying without a stable idempotency key duplicates messages; keeping drafts only in component state loses field messages on navigation or restart.

**How to apply:** Merge outbox and server rows by client ID, flush sequentially on reconnect/focus, retain failed rows for manual retry, and clear user-scoped state on account changes. For polled history, use bounded pages with ordering that exactly matches the cursor and a supporting tenant/context/cursor index; mark only returned rows read.