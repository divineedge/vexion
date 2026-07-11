---
name: Generated API client dist goes stale after codegen
description: Downstream packages resolve the generated API client through its compiled dist, not src, so a codegen run alone isn't enough.
---

# Generated API client dist goes stale after codegen

**The rule:** Running the OpenAPI codegen step alone is not sufficient — the generated client package's compiled output must also be rebuilt before its new types/hooks are visible elsewhere in the workspace.

**Why:** Downstream packages resolve this lib through project-reference build output, not source, so new exports are invisible (and typecheck reports phantom missing exports) until that output is rebuilt.

**How to apply:** Treat "ran codegen" and "rebuilt the generated client's build output" as one atomic step whenever the API spec changes.
