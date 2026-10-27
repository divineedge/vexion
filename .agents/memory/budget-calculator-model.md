---
name: Budget calculator financial model (Divine Edge OS)
description: Design decisions behind artifacts/divine-edge-os/src/lib/budgetCalc.ts — why the math is shaped the way it is, so future changes stay consistent.
---

## Divisions + Company Total
Budget data is `BudgetYear[]` (one per fiscal year), each holding `divisions: DivisionBudget[]` (one full independent budget per line of business, e.g. Lawn Care / Landscaping) plus a company-level rollup.

**Why:** user explicitly wanted separate full budgets per division (not shared with a tag), each with its own required hourly rate, AND a combined/blended company-wide rate — not one or the other.

**How it works:** `computeCompanyTotal()` sums each division's man-hours, labor cost, and material cost. Overhead is summed per category across divisions but can be manually overridden per category (`year.overheadOverrides`) — this exists because shared costs (e.g. one insurance policy) can get double-entered once per division, and the override is how staff correct that at the company level. The combined margin is a cost-weighted blend of each division's own `targetNetMarginPct`, not a flat input.

## Required hourly rate uses man-hours, not crew-hours
`computeDivision()` divides required revenue by `manHoursYear = totalEmployees × weeks × days × hoursPerDay × efficiency` (totalEmployees = crewCount × employeesPerCrew).

**Why:** the original calculator computed billable hours from `crewCount` alone, ignoring `employeesPerCrew`. That meant hiring an additional worker raised total labor cost without raising the hours denominator, so the required rate went *up* when adding staff — backwards, since fixed overhead should spread over more capacity as headcount grows.

**How to apply:** any new capacity/labor field must flow into `manHoursYear` if it represents additional billable capacity, or it will reintroduce this bug.

## Zero employees means owner-led production
Treat the salaried owner/manager as a productive worker whenever the budget says they also work in the field, including after employees are added. Keep the salary included exactly once.

**Why:** replacing the manager's productive hours with the first employee's hours kept the denominator at one worker while adding employee payroll, causing the displayed man-hour rate to jump instead of spreading costs across both workers.

**How to apply:** count every person who produces field work in total man-hours. Exclude the owner/manager only when they are explicitly marked as office-only.

## P4P pay is `max(base, revenue share)`, never `base + bonus`
`employeeTotalPayPerHour = Math.max(employeeBaseHourlyRate, requiredHourlyRate * p4pPercentage / 100)`.

**Why:** the business's real P4P model is a wage floor (guaranteed base) with a performance-based upside that *replaces* the base when it's higher — not an additive bonus stacked on top of base pay.

## Material markup only covers materials' share of overhead
`recommendedMarkup` allocates overhead to materials in proportion to `estimatedAnnualMaterialCost / (totalLaborCost + annualOverhead + estimatedAnnualMaterialCost)`, not the full overhead-as-%-of-revenue.

**Why:** in a service business, hourly labor billing already carries most of overhead recovery; making material markup cover 100% of overhead (as the old formula did, via `overhead / requiredRevenue`) over-attributes overhead to material sales, especially when materials are a small fraction of the business.

## Minimum show-up cost
`minimumShowUpCost = requiredHourlyRate * minimumVisitHours` (per-division `minimumVisitHours` input, default 1). This is the floor price for dispatching a crew at all, regardless of job size — never quote below it.

## Stop-level pricing floor is a separate planning scenario
The user wants separate company and division stop-level calculators in addition to the existing standalone calculator, because operating costs can differ by division.

**Why:** The user explicitly asked to keep the existing calculator while adding these scopes.

**How to apply:** Keep company and division scenario overrides independent. Do not silently substitute example billable hours when the underlying budget has no billable capacity; require real hours before displaying a minimum price.

Keep the annual company/division man-hour budget and its Pricing Review targets intact. A stop-level scenario uses crew clock-hours: labor is paid for every crew member during on-site plus drive/setup time; fixed overhead is allocated through on-site billable crew hours only. Full stop cost divided by on-site hours is the travel-loaded true billable-hour cost. Per-clock-minute rates instead divide by all on-site and drive/setup minutes.

**Why:** The user requested a straightforward financial floor for a single stop in addition to the full annual budget. Mixing the annual man-hour denominator with a crew stop-hour denominator would multiply overhead by crew size or underpay travel. Allocating overhead to both travel and on-site time despite an on-site-only monthly denominator would over-recover the entered overhead.

**How to apply:** Keep the cost scope of monthly overhead and billable crew hours consistent. Use cost / (1 − target margin), not cost × (1 + margin), and round minimum quoted prices up to a cent. Treat prefilled scenarios as examples, never actual financials; prevent invalid or blank inputs from producing a misleading floor. Stop scenarios do not automatically rewrite service prices, annual budgets, or Pricing Review rates.
