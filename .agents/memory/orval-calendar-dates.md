---
name: Orval calendar-date coercion
description: Prevent generated response validators from turning calendar keys into timestamps.
---

For calendar keys that must remain YYYY-MM-DD strings, use a string pattern in OpenAPI and explicit calendar validation rather than `format: date`.

**Why:** This workspace's Orval Zod generation converts `format: date` to `zod.coerce.date()`. Parsing a response then serializing it changes the calendar key to an ISO timestamp, breaking date inputs and saved date-range defaults.

**How to apply:** Keep calendar dates distinct from timestamps. Test the actual serialized GET response as well as the PATCH body; do not merely check database persistence.
