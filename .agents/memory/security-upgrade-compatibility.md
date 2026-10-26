---
name: Security upgrade compatibility
description: Non-obvious constraints for security updates to shared validation, legacy mobile tools, and provider identifiers.
---

Do not force Expo's legacy tunnel tool from UUID 3 to UUID 11+, or force Expo CLI's private Zod 3 dependency to Zod 4, merely to clear an audit.

**Why:** The tunnel tool requires removed deep imports, and the CLI has its own validation compatibility needs. These are distinct from the application's validator and public UUID v4 consumers. A broad override can disable Expo Go development even though application builds compile.

**How to apply:** Update direct parents first; retain SDK-compatible native versions and isolated React runtimes. Audit the actual resolved graph and report unpatched development-only dependencies honestly. Do not suppress their findings or present a reduced count as proof that every issue is fixed.

Force-rebuild shared TypeScript project references after a major validation-library upgrade.

**Why:** Incremental builds can retain declarations generated against the old validator's generic types. Consumers then infer `any` or show spurious arithmetic/unknown-type errors, even with an otherwise valid upgrade.

**How to apply:** Rebuild shared declarations with the existing TypeScript build in force mode before assessing downstream type failures. The former Zod-3-only restrictions on Orval's `email()` and `looseObject()` APIs no longer apply after moving the application to Zod 4.

Update React Hook Form's resolver alongside a major Zod upgrade, and test both invalid and valid submissions.

**Why:** Older resolvers can compile against a new validator yet throw instead of displaying validation errors. Type checking alone does not establish form compatibility.

**How to apply:** Verify the resolver's actual supported validator versions and exercise error handling, not only schema parsing.

Keep Orval's external-reference protection enabled; explicitly allow only reviewed local specification fragments.

**Why:** Patched Orval versions reject external references by default, including legitimate local fragments previously resolved automatically. A wildcard restores code generation by also restoring the unwanted file/network exposure.

**How to apply:** Add individual local filenames only after reviewing the reference. Smoke-test the real full specification into temporary outputs rather than rewriting checked-in generated clients just to validate a security upgrade.

Mailchimp's MD5 subscriber identifier must not be changed to SHA-256 as a security cleanup.

**Why:** It is the provider's required lookup identifier, not a password hash or signature. Changing the algorithm breaks member updates without adding authentication protection.

**How to apply:** Explain this warning's context rather than changing the provider protocol. Validate file-server containment and payment origins with targeted negative tests; custom guards may still be flagged by static scanners and should be reported transparently.
