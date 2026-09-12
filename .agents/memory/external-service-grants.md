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

MCP initially supports remote Streamable HTTP clients with bearer headers, not
an OAuth consent flow.

**Why:** Shipping OAuth discovery or a sign-in button without a complete secure
authorization flow would misleadingly promise compatibility with OAuth-only
assistants. Real per-connection controls take priority over broad compatibility
claims.

**How to apply:** Keep setup documentation explicit about client authentication
requirements until a complete consent/PKCE flow has been implemented and verified.