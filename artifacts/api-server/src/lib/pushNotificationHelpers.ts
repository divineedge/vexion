/** Expo's documented token envelopes. Keep validation independent of database code for safe unit tests. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
}

/** These receipt/send errors mean this installation must never be retried. */
export function isRetiredExpoTokenError(error: string | undefined): boolean {
  return error === "DeviceNotRegistered" || error === "InvalidPushToken";
}