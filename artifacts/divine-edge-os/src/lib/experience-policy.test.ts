import { describe,it,expect } from "vitest";
import { policyTrialInput,policyTrialUntil } from "./experience-policy";
describe("software trial calendar input",()=>{
  it("converts a selected day to a full end-of-day UTC timestamp",()=>{
    expect(policyTrialUntil("2026-12-31")).toBe("2026-12-31T23:59:59.999Z");
    expect(policyTrialInput("2026-12-31T23:59:59.999Z")).toBe("2026-12-31");
  });
  it("preserves an existing exact timestamp when other policy fields change",()=>{
    expect(policyTrialUntil("2026-12-31T04:20:00.000Z")).toBe("2026-12-31T04:20:00.000Z");
    expect(policyTrialUntil(null)).toBeNull();expect(policyTrialInput(null)).toBe("");
  });
  it("rejects malformed and rollover dates rather than sending a broken value",()=>{
    expect(()=>policyTrialUntil("2026-02-31")).toThrow("valid trial");
    expect(()=>policyTrialUntil("not-a-date")).toThrow("valid trial");
  });
});
