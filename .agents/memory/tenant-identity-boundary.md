---
name: Tenant identity boundary
description: The server-side rule for preventing cross-business reads and writes.
---

**The rule:** Private staff APIs must require a valid staff session and derive tenant and user identity only from that verified session. Caller-supplied tenant/user headers are never an authorization boundary.

**Why:** Equipment records entered by a Divine Edge user were written to the legacy seed tenant because an older route trusted identity headers/defaulted to tenant 1. The destination tenant then could not see its own records, while the source tenant could.

**How to apply:** Install verified-session middleware before private route handlers, make session identity override or eliminate legacy identity headers, scope every parent/child query to that identity, and test missing, forged, invalid, expired, and cross-tenant combinations.