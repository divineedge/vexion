import { describe, expect, it } from "vitest";
import { invoiceServiceDate } from "./invoiceServiceDate";
import { parseCurrentChemicalWeather } from "./chemicalWeather";
const job = { scheduledAt: new Date("2026-10-02T12:00:00Z"), completedAt: new Date("2026-10-05T01:30:00Z") };
describe("service invoice dates", () => {
  it("defaults to actual completion in the tenant timezone, not the schedule or server date", () => {
    expect(invoiceServiceDate(job, {}, "America/Denver")).toBe("Completed Oct 4, 2026");
  });
  it("supports services using their scheduled date", () => {
    expect(invoiceServiceDate(job, { invoiceDateBasis: "scheduled" }, "America/Denver")).toBe("Scheduled Oct 2, 2026");
  });
  it("never pretends a scheduled date is a missing completion date", () => {
    expect(invoiceServiceDate({ ...job, completedAt: null }, {}, "UTC")).toBeNull();
  });
});
describe("current application weather", () => {
  const current = { time: "2026-10-08T12:00", temperature_2m: 65, wind_speed_10m: 5, wind_direction_10m: 270 };
  const now = Date.parse("2026-10-08T12:15:00Z");
  it("returns mph, Fahrenheit, direction and an observation timestamp", () => {
    expect(parseCurrentChemicalWeather({ current }, now)).toMatchObject({ temperature: 65, windSpeed: 5, windDirection: "W", observedAt: "2026-10-08T12:00:00.000Z" });
  });
  it("rejects stale conditions instead of using scheduled-day weather", () => {
    expect(() => parseCurrentChemicalWeather({ current }, now + 86400000)).toThrow(/stale/);
  });
  it("rejects incomplete provider responses rather than inventing data", () => {
    expect(() => parseCurrentChemicalWeather(null, now)).toThrow();
    expect(() => parseCurrentChemicalWeather({ current: { ...current, temperature_2m: null } }, now)).toThrow();
  });
});
