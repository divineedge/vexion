---
name: Dev DB schema drift
description: When an existing route 500s with a "Failed query" error on a column that exists in the Drizzle schema, check for dev-DB column drift before assuming a code bug.
---

Symptom: an existing (untouched) API route throws `Error: Failed query: select ... from "<table>" ...` with no underlying Postgres error message surfaced — happens because the query references a schema column that doesn't actually exist in the connected dev database yet (e.g. a column added to the Drizzle schema by a prior task whose `drizzle-kit push` was never run against this dev DB instance).

**Why:** Drizzle schema files and the live dev database can drift independently — schema edits alone don't touch the DB. If a previous task added a column in code but the push step didn't happen (or ran against a different DB instance), any route touching that table fails for everyone, not just new work.

**How to apply:** Compare database column metadata with the Drizzle schema before assuming a code regression. Review schema changes before applying them to development; if a broad push proposes unrelated destructive changes, apply only the reviewed additive development migrations instead.

Missing optional-feature columns on a shared tenant record can break login for everyone because login loads that record, not just authentication-specific fields.

**Why:** A successful code build does not prove the development schema was updated. Publishing compares actual development and production databases, so it cannot propagate columns that exist only in source code.

**How to apply:** Confirm full tenant queries execute against development before asking the user to republish. Keep production schema changes in the managed Publish flow, with no data-overwrite option. Treat a setup command that matched no workspace package as a failure, not successful reconciliation.
