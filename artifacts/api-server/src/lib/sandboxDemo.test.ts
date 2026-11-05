import { describe, expect, it } from "vitest";
import { tenantDayBounds } from "./sandboxDemoCalendar";

describe("sandbox demo calendar day", () => {
  it("uses the Denver tenant day, including after daylight saving time", () => {
    const bounds = tenantDayBounds("America/Denver", new Date("2026-11-05T15:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-11-05T07:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-06T07:00:00.000Z");
  });

  it("keeps a summer afternoon inside the daylight-saving day", () => {
    const bounds = tenantDayBounds("America/Denver", new Date("2026-07-15T18:30:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-16T06:00:00.000Z");
  });
});
