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

## P4P pay is `max(base, revenue share)`, never `base + bonus`
`employeeTotalPayPerHour = Math.max(employeeBaseHourlyRate, requiredHourlyRate * p4pPercentage / 100)`.

**Why:** the business's real P4P model is a wage floor (guaranteed base) with a performance-based upside that *replaces* the base when it's higher — not an additive bonus stacked on top of base pay.

## Material markup only covers materials' share of overhead
`recommendedMarkup` allocates overhead to materials in proportion to `estimatedAnnualMaterialCost / (totalLaborCost + annualOverhead + estimatedAnnualMaterialCost)`, not the full overhead-as-%-of-revenue.

**Why:** in a service business, hourly labor billing already carries most of overhead recovery; making material markup cover 100% of overhead (as the old formula did, via `overhead / requiredRevenue`) over-attributes overhead to material sales, especially when materials are a small fraction of the business.

## Minimum show-up cost
`minimumShowUpCost = requiredHourlyRate * minimumVisitHours` (per-division `minimumVisitHours` input, default 1). This is the floor price for dispatching a crew at all, regardless of job size — never quote below it.
