---
name: Navigation homes
description: User-requested bookmark and employee account management placement.
---
Only Dashboard is fixed at the top of navigation; other pages have their own section homes and may be bookmarked into the bookmarks area. Team/account management belongs under Employees, not Settings.

**Why:** The user found duplicated navigation and settings placement confusing and explicitly requested these changes.

**How to apply:** Keep invoice and estimate homes adjacent in Finance, preserve role gates and optional bookmarks, and keep employee account access separate from private HR records.

Quick-create actions must work repeatedly while already on the destination page, not just after navigating from another page.

**Why:** Wouter does not observe raw `history.replaceState` cleanup; its cached search can retain the consumed action and make the next same-page click appear to do nothing.

**How to apply:** Observe reactive router search and consume actions through router replacement, not mount-only effects or direct history calls. Verify opening, cancelling, and reopening the same quick action.
