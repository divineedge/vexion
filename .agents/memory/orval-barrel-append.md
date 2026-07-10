---
name: Orval barrel file append behavior
description: Orval v8 split mode appends duplicate export lines to the workspace index.ts on every codegen run; overwrite both lib barrel files after each run.
---

# Orval Barrel File Append Behavior

**The rule:** After every `orval` run, overwrite `lib/api-client-react/src/index.ts` and `lib/api-zod/src/index.ts` to remove appended duplicate exports.

**Why:** Orval v8 `mode: "split"` with `workspace` appends `export * from './generated/...'` (single quotes) to `{workspace}/index.ts` each run because `clean: true` only cleans the `target` subdirectory, not the workspace root. This causes `TS2308: Module already exported` errors.

**How to apply:** Rewrite both barrel files to their canonical content after any codegen invocation. Also: inline request bodies in the spec produce duplicate type+Zod names — always use named `$ref` schemas in `components/schemas` for request bodies.
