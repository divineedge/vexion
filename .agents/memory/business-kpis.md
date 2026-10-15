---
name: Business KPI preferences and spend
description: KPI placement, company defaults, customer spend, and service/job-cost reporting requirements.
---

KPIs belong on their own KPI Dashboard page, not the main Dashboard. Businesses choose the KPIs displayed there, which have detailed views, and the default date range through KPI dashboard settings. Include average customer spend for a year or year range.

**Why:** The user explicitly corrected placement: “this is the kpi dashboard not the main dashboard” and “i dont want the kpis on the main dashboard.” Each business needs control over the displayed measures and date defaults.

**How to apply:** Save choices per company, not per device or user. Preserve intentionally empty selections, distinguish missing data from measured zero, and keep main selections available in details. Keep owner field-work contributions in labor measures and compare budgets using identical completed-job cohorts.

Customer spend is paid invoice value per distinct paying customer in the selected dates. Annual breakdowns use each year's distinct customers; a multi-year range average is not silently annualized. Previously received deposits/prepaid funds are not new cash when applied to an invoice.

**Why:** Spend, earned service value and new cash receipts answer different questions. Mixing them double counts advance payments and distorts multi-year averages.

**How to apply:** State the denominator and whether tax is included. Retain historical paid/completed records in historical KPIs even when soft-archived, while excluding archived documents from current unpaid backlog. Clearly label estimated cost coverage and current-backlog snapshots.

## Pricing and job-cost reports

The KPI page must include average recorded time per service, cost/price per measurement with service-matrix grouping, individual-customer filtering across one or all services, and estimated-versus-recorded job profitability with labor and inventory split.

**Why:** The user wants these reports to check pricing and identify where estimates lose money, rather than just viewing company-wide totals.

**How to apply:** Compare matching timed/measured/cost-covered job cohorts. Keep square feet and linear feet separate and label current-property measurement fallbacks on old jobs. Missing hourly rates or purchase costs must not become zero-cost profit. Job-level contribution before overhead/P4P adjustments must not be labeled final accounting profit. Keep multi-service job totals unallocated rather than repeating the entire cost under each service.

Cost forecasts and rate assumptions must remain private financial data, separate from ordinary field/portal job and estimate payloads.

**Why:** Ordinary job and estimate serializers spread database rows; adding private cost snapshots directly to those rows can disclose purchase prices or payroll assumptions to restricted users.

**How to apply:** Preserve financial-office authorization for these snapshots and reports. Freeze new planning evidence without inventing historical costs for existing jobs or quotes.
