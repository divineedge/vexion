---
name: Orval api-zod barrel
description: After codegen, lib/api-zod barrel must export only from generated/api — not both api and types — to avoid TS2308 duplicate exports.
---

# Orval api-zod barrel pattern

After every orval codegen run, `lib/api-zod/src/index.ts` must be overwritten with:

```ts
export * from "./generated/api";
```

**Why:** orval v8 split mode generates two outputs:
- `generated/api.ts` — flat superset file containing ALL zod schemas (both data model schemas AND operation params/body validators)
- `generated/types/` — directory with one file per data model schema, each also exported from `types/index.ts`

When the barrel exports from both, data model schemas appear twice → TS2308 duplicate export errors crash the build.

**How to apply:** After `cd lib/api-spec && npx orval`, immediately overwrite both barrel files:
- `lib/api-client-react/src/index.ts` — see orval-barrel-append.md for its correct content
- `lib/api-zod/src/index.ts` — write only `export * from "./generated/api";`
