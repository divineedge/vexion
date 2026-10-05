---
name: Field App session unlock
description: Confirmed authentication cadence for fast field work without storing passwords.
---

**The rule:** Staff authenticate with email and password once per absolute 30-day server session. During that session, a securely stored token is unlocked only after a cold app launch or explicit Lock App action, never during route changes, job clock actions, or brief native UI transitions. On phones use the phone's own biometrics and device PIN/passcode fallback, not a separate app PIN. Remember the email, but never persist the password.

**Why:** Repeated biometric or password prompts during every job clock-in/out make field routes impractical, while storing a password would create unnecessary credential risk. The user requested the same unlock as the phone so failed fingerprints can fall back to the phone PIN.

**How to apply:** Preserve cold-start and explicit-lock verification, and immediately clear the saved session on logout, expiry/revocation, inactive-user or identity mismatch, or authenticated 401/403. Native credential attempt limits belong to the operating system; the browser's separate app PIN retains its five-attempt limit. Do not use transient AppState inactive/background events as an automatic lock trigger.