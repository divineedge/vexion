---
name: Inventory pricing contract
description: How buy price, markup, and sell price flow between DB, API, and frontend
---

## Rule
- **DB columns**: `unitPrice` = cost/buy price; `markedUpPrice` = sell price
- **API response**: `costPrice` = what we pay (role-gated); `unitPrice` = sell price; `markupPct` = derived from stored values
- **Markup derivation**: `markupPct = ((markedUpPrice / unitPrice) - 1) * 100`. Fall back to tenant default when `unitPrice === 0` to avoid division by zero.
- **On create/update**: compute sell price as `costPrice * (1 + effectiveMarkupPct / 100)` and persist to `markedUpPrice`; always persist an item-level markup override in sell price, not as a separate column.

**Why:** Keeping cost and sell in DB allows accurate markup recomputation and future per-item override tracking without an extra schema column. The API renaming (DB `unitPrice` → API `costPrice`) keeps the client-facing contract intuitive while avoiding a breaking migration.

**How to apply:** Any new code touching inventory pricing must: (1) read DB `unitPrice` as the cost, (2) compute effective markup from stored values rather than the tenant setting, (3) validate `costPrice >= 0` and `markupPct >= 0` before writing.
