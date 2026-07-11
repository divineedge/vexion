---
name: lib/db dist declarations go stale after schema edits
description: after editing lib/db/src/schema/*, downstream project-reference consumers (e.g. api-server) can show phantom missing-export/missing-column TS errors until lib/db's dist is rebuilt
---

Editing `lib/db/src/schema/*.ts` (adding a table, column, or export) does not automatically refresh
`lib/db`'s compiled `dist/*.d.ts` declaration files. Consumers that depend on `@workspace/db` via
TypeScript project references keep resolving the **stale** dist declarations, not the fresh source.

**Why:** this produces confusing, wide-reaching false errors — dozens of `TS2305`/`TS2339` for
exports/columns that clearly exist in the current source (e.g. `stopServiceFlagsTable`,
`mediaAttachmentsTable`, missing tenant/user columns) — that look like real regressions but are just
a stale build artifact.

**How to apply:** after any change to `lib/db/src/schema` (new table, new column, new export),
run `cd lib/db && npx tsc --build --force` before typechecking or trusting errors in downstream
packages like `artifacts/api-server`. If a downstream typecheck shows a flood of missing-export
errors right after a schema change, rebuild `lib/db`'s dist first — don't start editing the
downstream code to "fix" errors that are actually just stale.
