---
name: Billing email recovery
description: Why interrupted invoice sends require provider verification rather than automatic retries.
---

Treat a lost provider response or abandoned send as uncertain, not proof of failure. Recovery must not automatically resend, and recording provider acceptance must never send a second message.

**Why:** SMTP and the supported HTTP providers do not share a reliable lookup contract, and a crashed process may lose the provider message ID even after acceptance. The chosen baseline is provider-specific staff verification with recorded evidence; a missing search result alone is insufficient evidence of non-delivery.

**How to apply:** Preserve this conservative recovery policy when extending provider integrations. Any automated verification should prove acceptance or definite non-submission; otherwise leave the attempt unresolved. Provider acceptance is not a guarantee of inbox delivery.

Never reserve a connection from the ordinary query pool while a sender will need another pooled connection. Live-send guards use a small, separately bounded set of dedicated sessions instead of open transactions.

**Why:** At the pool limit, senders can otherwise each hold one connection while waiting forever for a second. Also, legacy attempted-but-pending emails must be quarantined: the older retry policy could leave accepted messages in that state.

**How to apply:** Preserve both pool availability and upgrade-path quarantine when changing retry or worker concurrency behavior.
