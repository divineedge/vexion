import { describe, expect, it } from "vitest";
import { credentialInput, credentialStatus, warningDays } from "./hrCredentials";

describe("credential calendar dates and warning boundaries", () => {
  it("keeps optional dates and rejects invalid dates/types", () => {
    expect(credentialInput({ credentialType: "license", expiresOn: "" })).toEqual({ credentialType: "license", expiresOn: null });
    expect(credentialInput({})).toEqual({ credentialType: null, expiresOn: null });
    expect(() => credentialInput({ credentialType: "license", expiresOn: "2026-02-30" })).toThrow("valid calendar");
    expect(() => credentialInput({ expiresOn: "2026-12-01" })).toThrow("require a license");
    expect(() => credentialInput({ credentialType: "passport" })).toThrow("license or certificate");
  });
  it("is valid through the expiration day and includes the lead-time boundary", () => {
    expect(credentialStatus("2026-10-12", "2026-10-12", 0)).toBe("upcoming");
    expect(credentialStatus("2026-10-11", "2026-10-12", 30)).toBe("expired");
    expect(credentialStatus("2026-11-11", "2026-10-12", 30)).toBe("upcoming");
    expect(credentialStatus("2026-11-12", "2026-10-12", 30)).toBe("current");
    expect(credentialStatus(null, "2026-10-12", 30)).toBe("no_expiration");
    expect(credentialStatus("2028-02-29", "2028-02-28", 1)).toBe("upcoming");
  });
  it("accepts only company lead times within bounds", () => {
    expect(warningDays(0)).toBe(0);
    expect(warningDays(365)).toBe(365);
    for (const input of [-1, 366, 2.5, "30", null]) expect(() => warningDays(input)).toThrow("whole number");
  });
});
