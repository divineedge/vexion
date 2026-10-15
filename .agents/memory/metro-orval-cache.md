---
name: Metro regeneration and workflow restarts
description: Generated-client deletion invalidates Metro resolution; stale CLI children can keep the managed port occupied.
---

Restart Metro after regenerating the shared API client. Generation temporarily deletes source files and the watcher may retain failed module resolution.

**Why:** Orval cleans its output directory before recreating modules; Metro may not recover resolution automatically.

**How to apply:** Restart the existing Field App managed workflow, not a duplicate server or workflow. If restart prompts to use another port, inspect the same app's existing Expo CLI processes: a prior child may have survived its workflow restart. Stop those stale CLI children before restarting the managed workflow on its configured port. Do not accept a different port or print environment credentials while diagnosing the process.
