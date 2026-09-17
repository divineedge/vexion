import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  bulkFuelTanksTable: {},
  bulkFuelTransactionsTable: {},
  equipmentFuelLogsTable: {},
  equipmentTable: {},
}));

import { formatTank, formatTransaction } from "./bulkFuel";

describe("bulk fuel presentation arithmetic", () => {
  it("converts cents per thousandths to displayed dollars per gallon", () => {
    expect(formatTank({
      id: 1, name: "Yard tank", fuelType: "gas", capacityThousandths: null,
      availableThousandths: 1_000, inventoryValueCents: 500, isActive: true, createdAt: new Date("2026-01-01T00:00:00Z"),
    } as any).unitCostPerGallon).toBe(5);
    expect(formatTransaction({
      id: 1, tankId: 1, tenantId: 1, type: "dispense", date: "2026-01-01",
      gallonsThousandths: -1_000, totalCostCents: -500, supplier: null, reference: null, notes: null,
      equipmentId: null, equipmentName: null, fuelLogId: null, idempotencyKey: null, createdAt: new Date("2026-01-01T00:00:00Z"),
    } as any).costPerGallon).toBe(5);
  });
});