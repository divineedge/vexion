---
name: Startup schema locks
description: Why cross-table background scans must wait for startup schema work.
---
Start new cross-table background scans only after startup schema and trigger installation finishes.

**Why:** A read-only HR reminder scan held locks across tenant and staff tables while payroll trigger installation requested schema locks in a different order. PostgreSQL detected a deadlock and terminated API startup.

**How to apply:** Gate new scheduler startup on schema installation completing rather than launching it as a module-import side effect. A successful build/typecheck cannot catch this runtime lock interaction.
