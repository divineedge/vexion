---
name: PostgreSQL pool disconnect handling
description: Production APIs must survive transient idle PostgreSQL connection failures.
---

**The rule:** Every node-postgres Pool must have an error listener that records idle-client failures without allowing Node's unhandled-event behavior to terminate the process.

**Why:** A transient production database connection termination crashed the API shortly after publish. The database and all records remained intact, but failed reads made the application appear empty until the process restarted.

**How to apply:** Attach the listener immediately after constructing the shared Pool. Treat an empty UI during a database outage as a read failure, compare production row counts before any restore, and never infer deletion from a transient connection error.