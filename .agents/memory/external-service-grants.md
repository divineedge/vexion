---
name: External service authorization decisions
description: Why external integrations use explicit business-wide service grants instead of employee sessions or field-role visibility.
---

External integrations are owner-delegated service actors, not employees. Selected
resource categories intentionally cover the business rather than one employee's
crew, equipment assignments, or selected customer records.

**Why:** The requested control is a separate permission set for each connected
assistant or service. Reusing employee sessions would tie automations to staff
logins and create misleading interactions with field-only visibility rules.
The owner must see the business-wide scope warning before granting access.

**How to apply:** Preserve the separate external authorization boundary. Do not
route external credentials through ordinary staff middleware or infer employee
roles from a connection. If per-record restrictions are added later, make them
explicit connection settings rather than silently borrowing staff visibility.

OAuth assistant registrations must remain explicit owner-approved connections,
not automatic grants to any client that discovers the server.

**Why:** Public client registration identifies an assistant but does not establish
trust or permission to access a business. Exact pre-registered callbacks and
per-connection scope limits make that boundary clear without introducing remote
metadata fetching or open registration.

**How to apply:** Preserve explicit owner registration and consent when extending
OAuth. Treat official provider setup documentation and actual live-account
verification as separate evidence; protocol support alone never justifies
claiming compatibility with a named assistant.