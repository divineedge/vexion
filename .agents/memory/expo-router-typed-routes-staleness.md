---
name: Expo Router typed routes staleness
description: New route files under app/ fail TS typecheck (router.push pathname not assignable) until .expo/types/router.d.ts is regenerated.
---

When `experiments.typedRoutes: true` is set in app.json (Expo Router), the file `.expo/types/router.d.ts` is a generated union of all known route paths. It is only regenerated when the Expo dev server / Metro bundler runs — not automatically on `tsc --noEmit`.

**Why:** Adding new files under `app/` (e.g. a new screen `app/(app)/equipment.tsx`) makes them valid routes at runtime, but `router.push('/(app)/equipment')` still fails typecheck with `TS2345: not assignable to ... hrefInputParams` until the types file catches up.

**How to apply:** After adding/renaming route files, run `npx expo start` briefly (it regenerates `.expo/types/router.d.ts` on startup) then kill it, or restart the workflow, before trusting `tsc --noEmit` results in that app.
