---
name: Equipment ledger cumulative-reading design
description: Why the Divine Edge OS equipment Operating/Run Cost ledger can show $0 / 0 hrs even with valid data — not a bug.
---

The equipment cost ledger's "Operating / Run Cost" runtime-hours figure is computed as
`last hour-meter reading in date range − first hour-meter reading in date range`, because
readings (`equipmentReadingLogsTable`) are cumulative odometer/hour-meter values, not deltas.

**Why:** A single reading has no "previous" point to diff against, so with only one reading
ever logged for a piece of equipment, `runtimeHoursInWindow` is correctly `0` — this looks like
a bug (ledger shows $0.00) but is expected until a second reading exists.

**How to apply:** When testing or debugging the equipment ledger looking "empty", check how many
hour-meter/mileage readings exist for that equipment in the queried date range before assuming
the pipeline is broken. Same logic lives in `artifacts/api-server/src/routes/equipment.ts`
(`GET /equipment/:id/ledger`).
