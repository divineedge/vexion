---
name: Field App session unlock
description: Confirmed authentication cadence for fast field work without storing passwords.
---

**The rule:** Staff authenticate with email and password once per absolute 30-day server session. During that session, a securely stored token is unlocked with biometrics or PIN only after a cold app launch or explicit Lock App action, never during route changes, job clock actions, or brief native UI transitions. Remember the email, but never persist the password.

**Why:** Repeated biometric or password prompts during every job clock-in/out make field routes impractical, while storing a password would create unnecessary credential risk.

**How to apply:** Preserve cold-start and explicit-lock verification, and immediately clear the saved session on logout, expiry/revocation, inactive-user or identity mismatch, authenticated 401/403, or five failed PIN attempts. Do not use transient AppState inactive/background events as an automatic lock trigger.