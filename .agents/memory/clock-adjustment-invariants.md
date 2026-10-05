---
name: Clock adjustment invariants
description: Rules for correcting completed employee time without weakening payroll history or tenant-local date behavior.
---

Recorded clock-in and clock-out events are immutable. Corrections are separate effective timestamps, and every correction appends a before/after audit event with the actor and required reason. Payroll and operational reports use effective timestamps.

The field clock-out flow must always save the actual server-recorded clock-in and clock-out events. It must not offer field staff a shortcut that substitutes a scheduled appointment time for either event; geofence coordinates are supporting evidence, not replacement timestamps.

**Why:** Mutating recorded events destroys payroll evidence, while storing corrections without updating every aggregate creates contradictory totals. “Same work day” must use the tenant timezone because UTC boundaries do not match local payroll days.

**How to apply:** Field timers derive duration from their server event timestamps and capture available device location at both ends. Any separate manager correction surface must be tenant-scoped, authorized server-side, transactionally locked, append-only in audit history, and validated against the tenant’s calendar day before effective totals are recalculated.

Starting a job timer must also start the employee's main/day clock if it is off. Preserve an existing main-clock entry and leave it running when stopping or switching jobs.

**Why:** The user explicitly requested automatic main-clock entry when clocking into a job; starting two independent requests risks recording job time without payroll time.

**How to apply:** Keep job and main-clock creation atomic under the same employee lock and refresh both clock displays after a job start.