import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GEOFENCE_ENTRY_DEBOUNCE_MS, hasExactlyOneWorkLink, haversineMeters, isAssignedToWork, isDuplicateGeofenceEntry, isInsideGeofence, isWithinScheduleDay } from "./geofence";

describe("geofence arrival validation", () => {
  it("accepts coordinates inside a property radius", () => {
    const distance = haversineMeters(40.0000, -75.0000, 40.0005, -75.0000);
    assert.equal(isInsideGeofence(distance, 100), true);
  });

  it("rejects coordinates outside a property radius", () => {
    const distance = haversineMeters(40.0000, -75.0000, 40.0100, -75.0000);
    assert.equal(isInsideGeofence(distance, 100), false);
  });

  it("defines a reasonable five-minute server debounce interval", () => {
    assert.equal(GEOFENCE_ENTRY_DEBOUNCE_MS, 5 * 60 * 1000);
  });

  it("deduplicates only a same-property arrival inside the debounce window", () => {
    const now = new Date("2026-03-17T12:00:00.000Z");
    assert.equal(isDuplicateGeofenceEntry(new Date(now.getTime() - 4 * 60 * 1000), now), true);
    assert.equal(isDuplicateGeofenceEntry(new Date(now.getTime() - 6 * 60 * 1000), now), false);
    assert.equal(isDuplicateGeofenceEntry(null, now), false);
  });

  it("requires one scheduled work link and accepts direct or crew assignment only", () => {
    assert.equal(hasExactlyOneWorkLink(7, null), true);
    assert.equal(hasExactlyOneWorkLink(null, 8), true);
    assert.equal(hasExactlyOneWorkLink(null, null), false);
    assert.equal(hasExactlyOneWorkLink(7, 8), false);
    assert.equal(isAssignedToWork(12, false, 12), true);
    assert.equal(isAssignedToWork(null, true, 12), true);
    assert.equal(isAssignedToWork(99, false, 12), false);
  });

  it("accepts only work scheduled during the caller's current day", () => {
    const now = new Date("2026-03-17T12:00:00.000Z");
    assert.equal(isWithinScheduleDay(new Date("2026-03-17T00:00:00.000Z"), now), true);
    assert.equal(isWithinScheduleDay(new Date("2026-03-18T00:00:00.000Z"), now), false);
    assert.equal(isWithinScheduleDay(null, now), false);
  });
});