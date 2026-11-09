import { describe, expect, it } from "vitest";
import { coerceEstimateReminderSettings } from "./estimateReminderSettings";
import { isMissingColumnError } from "./settingsFallback";

describe("settings documents that are missing", () => {
  it("returns reminder defaults for null, empty, and partial JSON", () => {
    expect(coerceEstimateReminderSettings(null)).toEqual({ enabled: false, rules: [] });
    expect(coerceEstimateReminderSettings(undefined)).toEqual({ enabled: false, rules: [] });
    expect(coerceEstimateReminderSettings("{}")).toEqual({ enabled: false, rules: [] });
    expect(coerceEstimateReminderSettings({ enabled: true, rules: [{ offsetDays: 3, label: "Nudge", channels: ["email"], notifyAdmin: false, createTask: false }] }).enabled).toBe(true);
    expect(coerceEstimateReminderSettings({ enabled: true }).rules).toEqual([]);
    expect(coerceEstimateReminderSettings({ enabled: true }).enabled).toBe(false);
  });

  it("recognizes a missing database column", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError(new Error('column "require_card_on_acceptance" does not exist'))).toBe(true);
    expect(isMissingColumnError(new Error("connection refused"))).toBe(false);
  });
});
