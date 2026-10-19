---
name: Service invoice dates and application weather
description: Business rules distinguishing the service date on invoices from chemical application time.
---

Service invoice dates are selected per service, defaulting to actual completion; scheduled-date billing remains available. Apply the choice at invoice creation and preserve existing invoices. Invoice issue dates are separate from service dates.

**Why:** The user says delayed or early work must show its completion day when it matters to that service, while other services may use their scheduled day.

**How to apply:** Cover every job-to-invoice path, including automatic completion billing and weekly/recurring billing. Format service dates in the tenant timezone, never the server timezone. Do not infer completion from the schedule when completion is missing.

Chemical conditions belong to the actual application time regardless of the service's billing-date choice.

**Why:** The user explicitly requires current weather, not weather for the scheduled day. Current weather must not be attached to a historical application.

**How to apply:** Distinguish estimated current conditions from on-site observations, allow manual correction, retain observation timestamps, and reject stale provider data. Changing application time must clear automatically loaded weather; a slow initial weather request must not refill a backdated form.

The scheduler's fourteen-day forecast is for admins and managers planning crews and individual employees, especially spraying. It is not evidence of conditions at application time or permission to spray.

**Why:** The user wants weather and crew schedules together for planning, but separately requires chemical records to reflect actual application-time conditions.

**How to apply:** Use the selected property's saved map pin and clearly identify the company timezone. Preserve crew/employee filters when navigating forecast dates, identify extended-range uncertainty, and never copy planning forecasts into chemical application records or label a forecast as automatic spray approval.
