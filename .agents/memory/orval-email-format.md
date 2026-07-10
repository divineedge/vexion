---
name: Orval email format incompatibility
description: Using format:email in OpenAPI spec breaks Zod v3 typecheck when Orval generates zod.email()
---

`format: email` on a string field in `lib/api-spec/openapi.yaml` causes Orval to generate `zod.email()` which is **Zod v4 syntax**. The workspace uses Zod v3, so `typecheck:libs` fails with `Property 'email' does not exist on type 'typeof import(".../zod/index")'`.

**Fix:** Remove `format: email` from OpenAPI string fields. Use plain `type: string` instead. Email validation can be added manually in route handlers if needed.

**Why:** The workspace `pnpm-workspace.yaml` catalogs Zod v3. Orval's zod client mode generates the format validator using the Zod v4 API when `format: email` is present.

**How to apply:** After writing any OpenAPI spec, search for `format: email` and remove those lines before running codegen.
