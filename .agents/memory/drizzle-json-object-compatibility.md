---
name: Drizzle JSON object compatibility
description: Null-prototype answer maps can fail Drizzle's entity inspection before JSON serialization
---
Normalize JSON maps to ordinary objects before passing them as Drizzle column values. Protect keys by allowlisting the active definition and rejecting reserved identifiers, not by relying only on null prototypes.

**Why:** In this workspace's Drizzle version, a null-prototype answer map caused entity inspection to throw while saving an otherwise valid hiring application.

**How to apply:** This applies to dynamic answer/metadata maps passed directly to insert/update operations. JSON-compatible content alone is not enough if the ORM inspects the value's constructor before serializing it.
