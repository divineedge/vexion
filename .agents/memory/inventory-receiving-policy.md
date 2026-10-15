---
name: Inventory receiving policy
description: Vendor purchases update stock atomically without duplicate receipts or lost legacy quantities.
---

Receiving inventory from a vendor expense must be atomic and retry-safe; changing catalog cost is an explicit option and preserves the existing selling markup unless overridden.

**Why:** The user wants purchases to flow into inventory and optionally supply prices, while updates must preserve business records.

**How to apply:** Preserve historical quantities and prices, keep receiving evidence immutable, and use adjustments rather than deleting received purchases. The cash ledger retains the full purchase; inventory purchases must not also become operating expense when consumed materials are counted in cost of goods sold.

Purchase sales tax is entered as a percentage and included once in the vendor expense total. Including it in supply unit cost is optional; updating catalog prices remains an explicit choice and preserves markup.

**Why:** The user asked for supplier sales tax to optionally become part of supply pricing. This is purchase tax, not a new tax charged on customer invoices.

**How to apply:** Keep pre-tax purchase cost and tax evidence so later price changes cannot rewrite what was received. Do not silently change customer invoice taxation.
