---
name: Owner scheduling eligibility
description: Durable rule for when company owners can appear in field-work assignment and crew membership controls.
---

Company owners are eligible for individual job assignment, crew management, and crew membership only when the tenant explicitly enables owner field-work scheduling. Technicians and crew managers remain eligible by role; super admins are never field assignees.

**Why:** Owner is primarily an administrative role, but some businesses also need the owner to perform field work. A tenant setting supports both operating models without broadening owner permissions or silently treating every owner as field staff.

**How to apply:** Any new job-assignment, crew-member, crew-manager, routing, or scheduling picker must use the same tenant-controlled rule, and APIs must enforce tenant ownership, active-user status, and individual-versus-crew exclusivity.

Include owners in P4P and job-efficiency reports when owner field-work availability is enabled, including periods with tracked time but no priced jobs. Base hourly rate must remain visible without priced jobs.

**Why:** The user explicitly extended owner availability to these reports and reported that time-only work was hiding base pay and the owner's efficiency.

**How to apply:** Keep base pay from effective master-clock time separate from revenue-dependent P4P earnings. A missing rate means unconfigured, not zero pay.

Turning off owner field-work availability must not remove the owner's already recorded work from payroll or change approved payroll history.

**Why:** Scheduling eligibility controls future assignments, not whether recorded work deserves compensation.

**How to apply:** Include owners with historical clock/job earnings in the relevant pay period regardless of the current scheduling toggle; never reconstruct or overwrite approved snapshots.