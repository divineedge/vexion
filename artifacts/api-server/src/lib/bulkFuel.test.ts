import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  bulkFuelTanksTable: {},
  bulkFuelTransactionsTable: {},
  equipmentFuelLogsTable: {},
  equipmentTable: {},
}));

import { bulkFuelLossExceedsThreshold, formatTank, formatTransaction, parseBulkFuelLossAlertSettings } from "./bulkFuel";

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

describe("bulk fuel loss alert settings", () => {
  it("accepts disabled and enabled threshold settings", () => {
    expect(parseBulkFuelLossAlertSettings({
      periodDays: 30, gallonThreshold: null, valueThreshold: 125.5,
    })).toEqual({ periodDays: 30, gallonThreshold: null, valueThreshold: 125.5 });
  });

  it.each([
    [{ periodDays: 0, gallonThreshold: null, valueThreshold: null }, "periodDays"],
    [{ periodDays: 30.5, gallonThreshold: null, valueThreshold: null }, "periodDays"],
    [{ periodDays: 366, gallonThreshold: null, valueThreshold: null }, "periodDays"],
    [{ periodDays: 30, gallonThreshold: 0, valueThreshold: null }, "gallonThreshold"],
    [{ periodDays: 30, gallonThreshold: null, valueThreshold: -1 }, "valueThreshold"],
  ])("rejects invalid settings %#", (settings, message) => {
    expect(() => parseBulkFuelLossAlertSettings(settings)).toThrow(message);
  });

  it("triggers either threshold only when it is strictly exceeded", () => {
    const settings = { periodDays: 30, gallonThreshold: 10, valueThreshold: 100 };
    expect(bulkFuelLossExceedsThreshold(10, 100, settings)).toBe(false);
    expect(bulkFuelLossExceedsThreshold(10.001, 1, settings)).toBe(true);
    expect(bulkFuelLossExceedsThreshold(1, 100.01, settings)).toBe(true);
    expect(bulkFuelLossExceedsThreshold(1000, 1000, {
      periodDays: 30, gallonThreshold: null, valueThreshold: null,
    })).toBe(false);
  });
});