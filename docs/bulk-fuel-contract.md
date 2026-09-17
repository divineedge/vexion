# Bulk fuel and equipment fueling

This feature extends the existing equipment fuel logs and pre-trip transaction;
it does not create a second equipment expense or a second log for one fill.
All paths below are relative to `/api`. Quantities are US gallons.

## Cost and inventory rules

- A tank tracks remaining gallons and remaining purchase value.
- Deliveries add gallons and actual total paid. Opening balance is a separately
  labeled intake for fuel already in the tank; allow it only before other activity.
- Dispensing uses current weighted-average cost (value / gallons), snapshots
  the unit price and amount on the equipment fuel log, and deducts both.
- Use thousandths of a gallon and cents for stored inventory arithmetic; avoid
  floating-point drift. A full draw consumes remaining value exactly.
- Later deliveries never reprice earlier equipment logs.
- Fuel added is the measured metric, not estimated engine fuel consumption.
- Purchases do not create generic operating expenses; existing reports count
  fuel cost only through equipment fuel logs as fuel is dispensed.
- Explain that recording a tank purchase again as a separate operating fuel
  expense would double count it. Do not alter existing expense records.
- Reject insufficient inventory, invalid/nonfinite/negative quantities/cost,
  tank capacity overflow, inactive tanks, cross-tenant tanks/equipment/jobs.
- Lock equipment then tank consistently. Receipt, dispensing, pre-trip, and fuel
  deletion/refund transactions must be atomic and replay-safe.
- Existing historical station/unknown-source records remain unchanged.

## Tank management API

Operation IDs generate the named React hooks using normal Orval conventions.
Office roles (owner, office manager, department manager) manage tanks/intakes
and view transaction history. Other verified staff may list active tank options
and dispense only to equipment they can currently access.

`listBulkFuelTanks`: GET `/bulk-fuel/tanks?includeInactive=false` → BulkFuelTank[].
`createBulkFuelTank`: POST `/bulk-fuel/tanks` → BulkFuelTank.
  Input `{ name, fuelType, capacityGallons?: number|null }`.
`updateBulkFuelTank`: PATCH `/bulk-fuel/tanks/:id` → BulkFuelTank.
  Input partial above plus `isActive?: boolean`. Only empty tanks may be deactivated.
`listBulkFuelTransactions`: GET `/bulk-fuel/tanks/:id/transactions?limit=100&cursor=`
  → `{ data: BulkFuelTransaction[], nextCursor: string|null }`.
`createBulkFuelIntake`: POST `/bulk-fuel/tanks/:id/intakes`
  → `{ tank: BulkFuelTank, transaction: BulkFuelTransaction, duplicate: boolean }`.
  Input `{ kind: "delivery"|"opening_balance", date: "YYYY-MM-DD",
    gallons, totalCost, supplier?, reference?, notes?, idempotencyKey }`.

BulkFuelTank: `{ id:number, name:string, fuelType:string,
capacityGallons:number|null, isActive:boolean, availableGallons:number,
inventoryValue:number, unitCostPerGallon:number, createdAt:string }`.

BulkFuelTransaction: `{ id:number, tankId:number,
type:"delivery"|"opening_balance"|"dispense"|"reversal", date:string,
gallons:number, totalCost:number, costPerGallon:number, supplier:string|null,
reference:string|null, notes:string|null, equipmentId:number|null,
equipmentName:string|null, fuelLogId:number|null, createdAt:string }`.
Transaction gallons/value are signed inventory changes (dispense is negative).
History is append-only. Editing a tank name must not rewrite old equipment-source
labels. Intake records are not silently editable after recording.

## Existing equipment fueling

Extend existing `createEquipmentFuelLog` request with:
`fuelSource?: "purchased"|"bulk_tank"`, `bulkFuelTankId?:number`,
`idempotencyKey?:string`. Require key for bulk; support legacy purchased clients.
Bulk ignores/rejects client prices: actual costs always calculated server-side.
For purchased fuel, preserve existing manual cost/per-gallon input behavior.

Extend fuel-log output and equipment-ledger fuel rows with:
`fuelSource: "purchased"|"bulk_tank"`, `bulkFuelTankId:number|null`,
`bulkFuelTankName:string|null`; gallons, costPerGallon, cost already exist.
Do not lose job or meter linkage. Deleting a bulk fuel log once restores its
original gallons and allocated cost to the tank, retaining a reversal movement.
Deletion must not refund twice; block refund into inactive tank with clear error.

Extend existing pre-trip request with the same source/tank fields (existing
idempotencyKey remains authoritative). Call the same transactional fuel primitive,
creating exactly one equipment fuel log, tank movement, and linked inspection.
Saved inspection description must use server-calculated source and price.
Return optional `fuelLogId`, `fuelCost`, `fuelCostPerGallon`,
`fuelSource`, `bulkFuelTankName` for a useful confirmation.
Checklist questions and completed inspection snapshots remain unchanged.

## Equipment fuel reporting

`getEquipmentFuelUsage`: GET `/reports/equipment-fuel-usage`
  params `{ period:"week"|"month"|"year", anchorDate:"YYYY-MM-DD", equipmentId?:number }`
  → `{ period, from:string, to:string, totalGallons:number, totalCost:number,
    averageCostPerGallon:number, fillCount:number, bulkGallons:number,
    purchasedGallons:number, equipment: EquipmentFuelUsageRow[] }`.
EquipmentFuelUsageRow: `{ equipmentId:number, equipmentName:string,
totalGallons:number, totalCost:number, averageCostPerGallon:number,
fillCount:number, bulkGallons:number, purchasedGallons:number }`.
Use tenant-calendar dates; Monday–Sunday weeks, calendar months/years, inclusive
date-key boundaries (not device-local UTC timestamp approximations).
Report is office-only and tenant-scoped, with optional equipment filter.
Count both ordinary and pre-trip fills through the same fuel-log table.

## Office and Field App

- Office Equipment page: discoverable Bulk Fuel entry to manage tanks, record
  delivery/opening balance, inspect signed history, edit/deactivate empty tanks.
- Equipment detail fuel entry: Purchased fuel / Bulk tank, tank picker, gallons,
  estimated unit/total cost, available balance; source visible on saved logs.
- Equipment detail and all-equipment view: week/month/year selector and anchor
  date using report above, gallons/cost totals and equipment breakdown.
- Field App pre-trip and equipment fuel form: same source picker and balance/
  price estimate, preserve existing equipment/job/meter inputs, disable impossible
  empty/insufficient choices with helpful explanation; server still authoritative.
- Clearly confirm a pre-trip fill was recorded on the selected equipment.
- Persist a generated idempotency key for a submission retry; generate a new one
  for genuinely new form contents or after success, not on every click.
- Generated hooks only for authenticated web/mobile API traffic; don't use
  hardcoded tenant headers. Handle errors visibly and invalidate tank, equipment
  fuel/history/ledger/report data after successful writes and reversals.