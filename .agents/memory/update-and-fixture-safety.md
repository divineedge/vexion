---
name: Update and fixture safety
description: Preserve business records during updates and avoid irreversible test fixture cleanup.
---
The user requires app updates to preserve existing customer and business information.

**Why:** The user explicitly asked that no customer or business information be lost during updates.

**How to apply:** Prefer additive migrations, inspect the target database before changing it, and use schema-only publishing—not overwriting production data.

Integration tests that create users or payroll records must roll back their whole fixture transaction rather than commit and delete afterward.

**Why:** Immutable payroll history protections prevent deleting baseline rate records, so teardown after committing fixtures can fail and leave test companies behind.

**How to apply:** Pass the transaction through the helpers under test; never disable immutable-history protections just to clean up tests.

Rollback-only test adapters must implement nested transactions using savepoints, not an ordinary connection-level COMMIT.

**Why:** A helper opening its own transaction can otherwise commit the surrounding fixture and make cleanup subject to immutable payroll protections.

**How to apply:** Keep one outer fixture transaction, use savepoints for transactional helpers, and roll back the outer transaction. Mock the payment SDK constructor as well as shared helpers to prevent alternate gateway factories making live calls.
