---
name: Legacy shared database cutover
description: Safe migration from a legacy cross-project database attachment to the project-owned Replit development and production databases.
---

**The rule:** Back up both sides and compare table and row counts after removing a legacy database connection. Do not assume the newly runtime-managed development database is empty or already contains the legacy data.

**Why:** Replit can immediately attach an existing project-owned database with a different dataset when the legacy secret is removed. Blindly restoring or skipping the restore can overwrite valid data or publish the wrong records.

**How to apply:** Verify the source dump, inventory the replacement database, preserve a second pre-restore backup, and use a single-transaction restore only after confirming which dataset should win. Publish with production database creation and current development data setup enabled.