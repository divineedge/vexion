import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  timeEntriesTable: {}, subTimersTable: {}, geofenceEntriesTable: {}, usersTable: {},
  taskBundleCompletionsTable: {}, taskBundlesTable: {}, jobsTable: {}, visitsTable: {},
  customersTable: {}, propertiesTable: {}, crewMembersTable: {},
}));
vi.mock("../routes/auth", () => ({ resolveStaffSession: vi.fn() }));

import { localDayBounds, zonedDayBounds } from "./timeTracking";

describe("selected schedule local date", () => {
  const originalTimezone = process.env.TZ;
  afterAll(() => { process.env.TZ = originalTimezone; });

  it("rejects malformed and impossible dates", () => {
    expect(localDayBounds("2026-02-30")).toBeNull();
    expect(localDayBounds("02/20/2026")).toBeNull();
  });

  it("uses exact local midnight boundaries with an exclusive next day", () => {
    process.env.TZ = "America/New_York";
    const bounds = localDayBounds("2026-03-08");
    expect(bounds).not.toBeNull();
    expect(bounds!.start.getHours()).toBe(0);
    expect(bounds!.end.getHours()).toBe(0);
    expect(bounds!.start.getDate()).toBe(8);
    expect(bounds!.end.getDate()).toBe(9);
    // DST spring-forward day is 23 real hours, proving this is a local calendar
    // boundary rather than an assumed 24-hour UTC window.
    expect(bounds!.end.getTime() - bounds!.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
  it("uses tenant IANA timezone boundaries including Denver DST and UTC", () => {
    const denver = zonedDayBounds("2026-03-08", "America/Denver")!;
    const utc = zonedDayBounds("2026-03-08", "UTC")!;
    expect(denver.end.getTime() - denver.start.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(utc.end.getTime() - utc.start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(zonedDayBounds("2026-02-30", "America/Denver")).toBeNull();
    // A scheduled instant at the tenant's midnight belongs to this day; the
    // exclusive end instant belongs to the next tenant day (geofence policy).
    expect(denver.start < denver.end).toBe(true);
  });
});