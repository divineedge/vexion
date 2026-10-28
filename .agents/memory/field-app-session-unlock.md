---
name: Field App session unlock
description: Confirmed authentication cadence for fast field work without storing passwords.
---

**The rule:** Phone unlock is optional. When staff enable it, they authenticate with email and password once per native device, then use the phone's biometrics or device PIN/passcode. A remembered phone must not require another password merely because 30 days passed. Remembered access remains revocable through sign-out, deactivation and password changes. The securely stored token is unlocked only after a cold app launch or explicit Lock App action, never during route changes, job clock actions, or brief native UI transitions. Remember the email, but never persist the password.

**Why:** The user explicitly requested password sign-in only on a new device and phone biometrics afterward. They also requested the same unlock as the phone so failed fingerprints can fall back to the phone PIN. Repeated prompts during every job clock-in/out make field routes impractical.

**How to apply:** Preserve cold-start and explicit-lock verification. Remember a native session on the server only after phone verification; ordinary browser sessions keep their existing expiry policy. Store native credentials device-only, not passwords or portable sign-in backups. Interrupted enrollment, missing display metadata, cancellation and temporary storage/network errors must not silently erase a valid phone credential. Clear on explicit logout, revocation, inactive-user or verified identity mismatch, or session-verification 401/403. Native credential attempt limits belong to the operating system; the browser's separate app PIN retains its five-attempt limit. Do not use transient AppState inactive/background events as an automatic lock trigger.

**Remembered choices:** Offer a visible password/skip option and a checked-by-default “Remember my choice on this device” checkbox for both enabling and declining setup. Keep remembered preferences scoped to the staff account and company on that device, separately from credentials, so sign-out can revoke access without repeatedly asking for setup.

**Why:** The user reports repeated biometric-enablement prompts at sign-in and explicitly asks for a deny/skip option and a remembered-choice checkbox.

**How to apply:** A remembered opt-in skips setup, not actual phone-owner verification. A remembered opt-out requires password sign-in after closing the app and must not silently restore an unprotected session. Unchecking the box allows setup to appear at the next password sign-in. Allow staff to revisit their choice without clearing unrelated company or customer data.

A successful password login is already authenticated; do not immediately force another phone prompt solely because phone unlock was previously enabled. Keep phone verification for restoring the saved session on the next cold launch, and only extend server-side remembered access after that verification.

**Why:** Otherwise “Sign in with password instead” leads straight back to the same unavailable phone unlock and becomes an unusable fallback.