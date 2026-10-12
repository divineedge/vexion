---
name: Recurring billing "completed work" mode
description: Design decisions behind completed-work recurring invoice templates (period window, double-billing guard, service-scope fan-out).
---

# Recurring billing "completed work" mode

**Completed-work templates must include older unbilled work**, not only jobs completed after their last run or creation.
**Why:** A timestamp cutoff can permanently strand backdated, late-entered, or previously held jobs. Invoice linkage is the authority for whether work was billed; the billing date still controls when a cycle runs.

**Double-billing guard reuses the existing "already invoiced" flag on the underlying work item**, the same one the older static/weekly billing path already sets.
**Why:** two billing paths must never both think the same completed work is still unbilled — one shared flag, not a second bookkeeping table.

**Scoping by service alone (no customer) fans out to one invoice per customer with qualifying work**, not a single combined invoice.
**How to apply:** an invoice always belongs to exactly one customer, so "bill this service for everyone" must mean N invoices, one per customer — treat any "run this template" result as a list of invoice ids, not a single id, even for customer-scoped runs (list of one).
