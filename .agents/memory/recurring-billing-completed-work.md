---
name: Recurring billing "completed work" mode
description: Design decisions behind completed-work recurring invoice templates (period window, double-billing guard, service-scope fan-out).
---

# Recurring billing "completed work" mode

**Period window is time-based, not a stored "period" field:** a completed-work template bills whatever qualifying work finished strictly after its last run (or its creation, if it's never run) up to now. No separate period-start/period-end columns were added — reuse the existing "last run" timestamp as the cutoff.
**Why:** avoids a second source of truth that could drift from the last invoice actually generated; keeps the static-mode template's existing columns untouched for backward compatibility.

**Double-billing guard reuses the existing "already invoiced" flag on the underlying work item**, the same one the older static/weekly billing path already sets.
**Why:** two billing paths must never both think the same completed work is still unbilled — one shared flag, not a second bookkeeping table.

**Scoping by service alone (no customer) fans out to one invoice per customer with qualifying work**, not a single combined invoice.
**How to apply:** an invoice always belongs to exactly one customer, so "bill this service for everyone" must mean N invoices, one per customer — treat any "run this template" result as a list of invoice ids, not a single id, even for customer-scoped runs (list of one).
