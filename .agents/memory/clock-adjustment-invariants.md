---
name: Clock adjustment invariants
description: Rules for correcting completed employee time without weakening payroll history or tenant-local date behavior.
---

Recorded clock-in and clock-out events are immutable. Corrections are separate effective timestamps, and every correction appends a before/after audit event with the actor and required reason. Payroll and operational reports use effective timestamps.

**Why:** Mutating recorded events destroys payroll evidence, while storing corrections without updating every aggregate creates contradictory totals. “Same work day” must use the tenant timezone because UTC boundaries do not match local payroll days.

**How to apply:** Any future time correction surface must be tenant-scoped, authorized server-side, transactionally locked, append-only in audit history, and validated against the tenant’s calendar day before effective totals are recalculated.