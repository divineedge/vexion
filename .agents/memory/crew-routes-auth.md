---
name: Crew routes must use generated auth-aware hooks
description: Frontend code must call generated api-client-react hooks, never raw window.fetch, or multi-tenant auth silently breaks.
---

# Crew routes must use generated auth-aware hooks

**The rule:** Frontend calls to the API (crews, and by extension any resource) must use the generated hooks from `@workspace/api-client-react` (e.g. `useListCrews`, `useCreateCrew`), never raw `window.fetch` with hand-set tenant/user headers.

**Why:** Raw fetch with hardcoded tenant/user headers bypasses the shared auth/tenant-scoping plumbing baked into the generated client, which breaks multi-tenant isolation and auth for other users even though it may look fine in local testing.

**How to apply:** Whenever adding a new frontend data call, check `@workspace/api-client-react` first for a generated hook covering that endpoint before writing any fetch call by hand.
