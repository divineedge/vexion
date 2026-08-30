import { describe, expect, it } from "vitest";
import { isExpoPushToken, isRetiredExpoTokenError } from "./pushNotificationHelpers";

describe("Expo push token/receipt classification", () => {
  it("accepts Expo token envelopes and rejects arbitrary input", () => {
    expect(isExpoPushToken("ExponentPushToken[abc_123-xyz]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc123]")).toBe(true);
    expect(isExpoPushToken("not-a-push-token")).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
  });

  it("retires only permanent Expo device-token receipt errors", () => {
    expect(isRetiredExpoTokenError("DeviceNotRegistered")).toBe(true);
    expect(isRetiredExpoTokenError("InvalidPushToken")).toBe(true);
    expect(isRetiredExpoTokenError("InvalidCredentials")).toBe(false);
    expect(isRetiredExpoTokenError(undefined)).toBe(false);
  });
});