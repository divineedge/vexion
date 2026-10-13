---
name: Portal company binding
description: Customer portal company context must survive updates without choosing another business.
---

The customer portal must stay tied to the correct company across app updates, reloads, sign-in, and sign-out. Never use a shared/default company as a fallback.

**Why:** The user repeatedly reported the portal switching to another business after updates and explicitly wants it locked to the company.

**How to apply:** Explicit company links select the authentication realm; verified sessions authorize records and determine signed-in branding. A generic staff preview uses the verified staff company, not stale customer context. Missing or unresolvable identity must remain neutral with sign-in blocked rather than guessing a business. Clear customer caches when changing identity and retain stable company links on logout. Test stale storage, invalid links, refreshes, and conflicting sessions.
