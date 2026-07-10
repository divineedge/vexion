---
name: OpenAPI paths placement
description: New route paths appended to the end of openapi.yaml land after components: and are silently ignored by orval
---

## Rule
When adding new paths to `lib/api-spec/openapi.yaml`, insert them **before** the `components:` line — never append to the end of the file.

**Why:** The file ends with the `components:` block (schemas). Appending with `cat >>` or inserting at the tail places new entries *after* `components:`, which is invalid YAML for the OpenAPI `paths` key. Orval generates 0 hooks for those paths with no warning.

**How to apply:** Always insert new path blocks using an `Edit` that targets the `components:` line as the anchor:
```yaml
  /my-new-path:
    get: ...

components:   ← insert your paths block just above this line
  schemas:
```
