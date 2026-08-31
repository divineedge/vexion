---
name: Lifecycle view selectors
description: UI guidance for active versus archived record views.
---

Use separate, explicitly highlighted “Active” and “Archived History” selectors rather than one button whose label describes the destination view.

**Why:** A destination-labeled toggle made a correct archived invoice list look like a broken active list during verification, and obscured whether restore had returned the user to the expected state.

**How to apply:** For any archive/restore interface, render both lifecycle states, highlight the selected state, and return to the active state after a successful restore.