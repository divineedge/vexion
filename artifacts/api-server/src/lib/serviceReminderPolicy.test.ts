import { describe, expect, it } from "vitest";
import { automatedServiceReminderAllowed, jobServiceIds, normalizeExcludedReminderServiceIds, normalizeServiceReminderMode } from "./serviceReminderPolicy";

describe("automated service reminders", () => {
  it("keeps the current behavior unless reminders are disabled or limited", () => {
    expect(normalizeServiceReminderMode(undefined)).toBe("enabled");
    expect(normalizeServiceReminderMode("never")).toBe("disabled");
    expect(automatedServiceReminderAllowed("enabled", [1], [])).toBe(true);
    expect(automatedServiceReminderAllowed("disabled", [], [4])).toBe(false);
  });

  it("sends selective reminders only for services that were not excluded", () => {
    expect(normalizeExcludedReminderServiceIds([2, 2])).toBeNull();
    expect(jobServiceIds({ serviceId: 3, lineItems: [{ serviceId: 4 }, { serviceId: "nope" }] })).toEqual([3, 4]);
    expect(automatedServiceReminderAllowed("selective", [2], [2])).toBe(false);
    expect(automatedServiceReminderAllowed("selective", [2], [2, 5])).toBe(true);
    expect(automatedServiceReminderAllowed("selective", [2], [])).toBe(false);
  });
});
