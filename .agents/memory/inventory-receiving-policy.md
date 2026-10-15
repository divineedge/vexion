---
name: Inventory receiving policy
description: Vendor purchases update stock atomically without duplicate receipts or lost legacy quantities.
---

Receiving inventory from a vendor expense must be atomic and retry-safe. Remaining purchase batches determine stock cost; updating the selling price is optional and preserves the existing markup unless overridden.

**Why:** The user wants purchases to flow into inventory and optionally supply prices, while updates must preserve business records.

**How to apply:** Preserve historical quantities and prices, keep receiving evidence immutable, and use adjustments rather than deleting received purchases. The cash ledger retains the full purchase; inventory purchases must not also become operating expense when consumed materials are counted in cost of goods sold.

Purchase sales tax is entered as a percentage and included once in the vendor expense total. Including it in supply unit cost is optional; updating selling prices remains an explicit choice and preserves markup.

**Why:** The user asked for supplier sales tax to optionally become part of supply pricing. This is purchase tax, not a new tax charged on customer invoices.

**How to apply:** Keep pre-tax purchase cost and tax evidence so later price changes cannot rewrite what was received. Do not silently change customer invoice taxation.

Job materials use the highest-cost remaining stock first. A cheaper purchase must not lower stock cost while higher-cost units remain. Preserve the actual cost assigned to each job even when later purchases change inventory cost; do not change P4P's separate material-sales deduction when introducing actual purchase costs.

**Why:** The user explicitly wants the highest price still in inventory used for supplies, with cost falling only after the higher-priced units are sold. Material purchase costs and material sales have different roles in profitability and labor budgets.

**How to apply:** Retain cost layers and job-use snapshots, make quantity corrections retry-safe, and restore the original costs on returns. Existing stock starts at its recorded cost; do not invent historical remaining batches or retroactively reprice jobs.

Shipping/delivery is optional on vendor expenses. Staff may allocate the whole fee across selected received supplies by pre-tax purchase value, using quantity if all purchase values are zero. It is separate from the subtotal taxed by the entered sales-tax percentage.

**Why:** The user wants optional shipping/delivery included in supply costs when appropriate, without counting the fee twice.

**How to apply:** Preserve the full cash expense, explicit capitalization choice, and per-receipt allocation; include tax and shipping only once in each received batch's cost.
