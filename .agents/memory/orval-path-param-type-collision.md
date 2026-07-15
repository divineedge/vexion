---
name: Orval path-param type collides with zod params const
description: One operation's generated TS path-params type can collide (TS2308) with the same-named zod validator const when wildcard-barreled together; renaming operationId or using $ref bodies does not fix it.
---

# Orval path-param type vs zod params const collision

**The problem:** For at least one operation shape (DELETE with an `in: path` id param plus an `in: query` param), orval's zod client emits a top-level exported const named `<OperationId>Params` (the path-params object) in `generated/api.ts`, while the typescript schema client emits a same-named `type <OperationId>Params` in `generated/types/<name>.ts`. When `lib/api-zod/src/index.ts` does `export * from "./generated/api"; export * from "./generated/types";`, TypeScript raises `TS2308: has already exported a member named 'X'`.

**What did NOT fix it:** converting inline request bodies/enums to named `$ref` schemas (fixes *body*-shaped collisions like `PauseRecurringSeriesBody`/`CompleteVisitBody`/`ImportBankTransactionBody`, all of which ARE fixed by using `$ref`), renaming the `operationId`, reordering path vs query parameters, `export type * from`.

**How to apply:** After every `pnpm codegen` run, run `pnpm run typecheck:libs` and read the reported member names — the set of colliding names varies per run (new endpoints can add new collisions, e.g. `ApplyBlueprintTemplateBody`, `GetEquipmentLedgerParams`, `GetRouteDayDetailParams` have all appeared). For each reported name, find its lowercase-first file in `lib/api-zod/src/generated/types/` and delete that file's `export * from './<file>';` line from `lib/api-zod/src/generated/types/index.ts` (in addition to the standard barrel-overwrite fix in orval-barrel-append.md). Safe because nothing imports that specific path-params/body type directly. Re-run typecheck after each deletion batch to confirm the collision list is now empty — don't assume the list is stable across runs.
