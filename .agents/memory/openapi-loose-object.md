---
name: OpenAPI looseObject crash
description: Using bare `type: object` (no properties) in OpenAPI spec causes zod.looseObject generation which crashes the api-server at startup
---

# OpenAPI looseObject crash

## The rule
Never use bare `type: object` (with no `properties` defined) inside array `items` or as a standalone schema in the OpenAPI spec. Always define explicit `properties` or `$ref` a named schema.

**Why:** orval's zod codegen generates `zod.looseObject({})` for open-ended objects — a Zod v4 API. The workspace pins Zod v3, where `looseObject` doesn't exist, so the generated call resolves to `undefined` and throws at runtime. The generated zod package is bundled into the api-server, so this crashes server startup, not just a typecheck.

**How to apply:** After any OpenAPI schema change, regenerate and grep the generated zod output for `looseObject` before restarting the server — a nonzero count means some schema still needs explicit properties.
