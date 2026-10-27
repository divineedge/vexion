---
name: Update and fixture safety
description: Preserve business records during updates and avoid irreversible test fixture cleanup.
---
The user requires app updates to preserve existing customer and business information.

**Why:** The user explicitly asked that no customer or business information be lost during updates.

**How to apply:** Prefer additive migrations, inspect the target database before changing it, and use schema-only publishing—not overwriting production data.

Integration tests that create users, payroll records, or jobs with financial baselines must roll back their whole fixture transaction rather than commit and delete afterward.

**Why:** Immutable payroll history protections and job-report baseline references prevent deletion-based teardown, so committing fixtures can fail cleanup and leave test companies behind.

**How to apply:** Pass the transaction through the helpers under test; never disable immutable-history protections just to clean up tests.

Rollback-only test adapters must implement nested transactions using savepoints, not an ordinary connection-level COMMIT.

**Why:** A helper opening its own transaction can otherwise commit the surrounding fixture and make cleanup subject to immutable payroll protections.

**How to apply:** Keep one outer fixture transaction, use savepoints for transactional helpers, and roll back the outer transaction. Mock the payment SDK constructor as well as shared helpers to prevent alternate gateway factories making live calls.

Time-based fixtures must account for PostgreSQL's transaction-frozen `now()`.

**Why:** A deadline set one second before JavaScript's current time can still be later than the outer rollback transaction's start, producing a flaky assertion that an expired lock is active.

**How to apply:** Put expired fixtures safely outside the duration of the entire suite, or explicitly use a wall-clock SQL function where wall-clock behavior is what the test measures. Do not weaken production lockout checks to accommodate a fixture-clock mismatch.
