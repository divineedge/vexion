---
name: Payroll history boundary
description: Effective-rate and immutable approval policy, including legacy baseline limitations.
---

Hourly, service, blueprint, and company P4P rate edits take effect at save time. Do not rewrite earlier rate history to make a past payroll match a later configuration. Closed clocks spanning a rate change must be split at the change.

**Why:** The user requires finalized pay to survive later employee and service edits. Existing pre-history rates are only a legacy baseline; the system cannot reconstruct rates that were never recorded.

**How to apply:** Keep original approvals immutable and store corrections as separate signed amounts with an actor, timestamp, and reason. Live estimates are not approved payroll. Use company-local calendar boundaries for approval periods, and prevent overlapping approvals.

Missing historical hourly rates are not zero-dollar rates and cannot be repaired by saving a current rate. Staff may explicitly approve P4P-only pay for affected historical work, but the approval must retain the missing-rate state and a reason attributed to the approver.

**Why:** Rejecting all such periods prevents both finalization and post-approval corrections. Silently backdating a new rate would instead invent payroll history.

**How to apply:** Flag the affected employees and P4P-only amounts, require a reason before approval, and retain that authorization alongside the original snapshot. Later corrections remain separate adjustments.
