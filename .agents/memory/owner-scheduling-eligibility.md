---
name: Owner scheduling eligibility
description: Durable rule for when company owners can appear in field-work assignment and crew membership controls.
---

Company owners are eligible for individual job assignment, crew management, and crew membership only when the tenant explicitly enables owner field-work scheduling. Technicians and crew managers remain eligible by role; super admins are never field assignees.

**Why:** Owner is primarily an administrative role, but some businesses also need the owner to perform field work. A tenant setting supports both operating models without broadening owner permissions or silently treating every owner as field staff.

**How to apply:** Any new job-assignment, crew-member, crew-manager, routing, or scheduling picker must use the same tenant-controlled rule, and APIs must enforce tenant ownership, active-user status, and individual-versus-crew exclusivity.