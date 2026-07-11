---
name: Dev DB schema drift
description: When an existing route 500s with a "Failed query" error on a column that exists in the Drizzle schema, check for dev-DB column drift before assuming a code bug.
---

Symptom: an existing (untouched) API route throws `Error: Failed query: select ... from "<table>" ...` with no underlying Postgres error message surfaced — happens because the query references a schema column that doesn't actually exist in the connected dev database yet (e.g. a column added to the Drizzle schema by a prior task whose `drizzle-kit push` was never run against this dev DB instance).

**Why:** Drizzle schema files and the live dev database can drift independently — schema edits alone don't touch the DB. If a previous task added a column in code but the push step didn't happen (or ran against a different DB instance), any route touching that table fails for everyone, not just new work.

**How to apply:** Before assuming a regression in your own change, run `psql "$DATABASE_URL" -c '\d <table>'` and compare to the Drizzle schema. If columns are missing, run `pnpm --filter @workspace/db run push` (safe/additive for new nullable columns) to sync, then retest.
