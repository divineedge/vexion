---
name: Launch readiness and account security
description: Software support privacy, safe rollout choices, and the limits of recovery evidence.
---
Software feedback is private to its author and the software support team; do not expose it to other businesses or automatically turn it into a public feature board. Customer service feedback remains a separate, company-scoped workflow.

**Why:** The user approved private problem reporting and feature requests alongside—but distinct from—customer satisfaction feedback.

**How to apply:** Keep internal support notes and attachments hidden from request authors. Company managers do not automatically gain access to employees' private software-support conversations.

Do not automatically enable live billing, enforce subscription policies on established companies, or enroll actual users in MFA as part of an update.

**Why:** These are consequential financial and access changes; the launch-readiness work must preserve existing business access and require explicit setup.

**How to apply:** Show configurable controls and onboarding evidence, preserve historical records, and clearly distinguish implemented controls from actual provider-tested behavior.

Authenticator encryption deliberately derives a purpose-specific key from the existing SESSION_SECRET. Preserve that secret during ordinary updates; plan re-encryption before rotating it.

**Why:** Reusing the managed secret avoids another setup credential, but rotating it makes existing authenticator secrets unreadable. One-use recovery codes must remain usable independently of that encryption key.

**How to apply:** Include secret/configuration recovery in disaster planning without putting secrets in exports, reports, logs, or memory. Password resets must not silently disable MFA.

A successful synthetic core-record restore is not proof of a whole-database, uploaded-file, or production recovery.

**Why:** Business-record exports intentionally exclude credentials and attachment bytes; the development drill exercises only representative synthetic records.

**How to apply:** Label the scope of every recovery claim and record real evidence. Never mark a complete production recovery as tested without an isolated restore and verification of file bytes and relationships.
