---
name: Tenant identity boundary
description: The server-side rule for preventing cross-business reads and writes.
---

**The rule:** Private staff APIs must require a valid staff session and derive tenant and user identity only from that verified session. Caller-supplied tenant/user headers are never an authorization boundary.

**Why:** Equipment records entered by a Divine Edge user were written to the legacy seed tenant because an older route trusted identity headers/defaulted to tenant 1. The destination tenant then could not see its own records, while the source tenant could.

**How to apply:** Install verified-session middleware before private route handlers, eliminate legacy identity headers from staff clients, and scope every parent/child query to session identity. Staff clients must call server logout before clearing their token so sign-out revokes access. Test missing, forged, invalid, expired, cross-tenant, and post-logout combinations.