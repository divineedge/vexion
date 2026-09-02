---
name: Route off-season authority
description: How route-level annual pause windows govern assigned jobs.
---

**The rule:** A route template's off-season window is authoritative for every job assigned to it. Jobs cannot retain a different pause window while assigned.

**Why:** The user explicitly chose enforcement rather than a default, so dispatch should not create route jobs that run during the route's closed season.

**How to apply:** Copy the route window on assignment, propagate template edits to all assigned jobs, and clear the inherited window when a job is unassigned or the route is deleted.