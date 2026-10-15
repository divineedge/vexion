---
name: Settings autosave policy
description: All settings tabs should save edits automatically without losing pending changes during navigation.
---
Settings changes must save automatically across all Settings tabs, rather than requiring a Save button.

**Why:** The user repeated that changing any setting in any tab should automatically save it, after encountering a website-quote toggle that did not persist.

**How to apply:** Use partial updates for independent company settings and complete validated snapshots where an endpoint requires them. Preserve unfinished drafts between tabs, serialize writes, and do not overwrite newer input with an older save response. Invalid drafts must say they are not saved. Navigation must not silently cancel pending saves; retain failed edits with a retry action. A background retry must never apply one company's edits after signing into another account.
