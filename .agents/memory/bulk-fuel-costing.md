---
name: Bulk fuel costing and reporting
description: Physical tank averaging, inventory-versus-equipment expense separation, and what fuel usage totals represent.
---

Bulk fuel uses the tank's current weighted-average purchase cost. Each fill
retains its recorded source and allocated cost; later purchases do not reprice
historical equipment fills.

**Why:** Deliveries bought at different prices physically mix in the same tank.
The requested workflow tracks what each asset receives without requiring staff
to choose purchase lots at the pump.

**How to apply:** Keep tank stock and its remaining value together when receiving,
dispensing, or reversing a fill. Preserve integer quantity/currency accounting
and consume the exact remaining value when a tank is emptied.

Tank receipts are inventory purchases in this feature, not additional equipment
fuel expenses. Equipment/job fuel cost is recognized through the existing fuel
logs when fuel is dispensed.

**Why:** Counting both the full bulk purchase and the allocated equipment fills
in the same operating-cost total doubles the expense.

**How to apply:** Future bank, expense, and receipt integrations must reconcile
their accounting treatment explicitly rather than independently adding both.
Do not change old manually recorded expenses automatically.

Fuel usage reports mean gallons added to equipment, not measured engine burn.
Historical unclassified fuel must not be relabeled as known station purchases
or repriced using today's bulk tank price.

**Why:** The available measurements are fueling entries, not tank sensors or
engine consumption telemetry; old entries do not identify the original source.

**How to apply:** Label totals as fuel added and recorded cost. Keep bulk versus
other/manual source breakdowns honest about historical data.