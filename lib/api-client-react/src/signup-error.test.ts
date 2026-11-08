import { describe, expect, it } from "vitest";
import { signupFailureMessage } from "./signup-error";

describe("signupFailureMessage", () => {
  it("asks the user to sign in when the account already exists", () => {
    expect(signupFailureMessage({ status: 409, message: "HTTP 409 Conflict" })).toBe(
      "An account with this email already exists. Please sign in instead.",
    );
    expect(signupFailureMessage({ message: "An account with that email already exists" })).toBe(
      "An account with this email already exists. Please sign in instead.",
    );
  });

  it("keeps a network failure distinct from a server error", () => {
    expect(signupFailureMessage(new TypeError("Failed to fetch"))).toBe(
      "Can't reach the server — check your connection.",
    );
  });

  it("shows the server message for other failures", () => {
    expect(signupFailureMessage({ status: 400, message: "Password must be at least 8 characters" })).toBe(
      "Password must be at least 8 characters",
    );
    expect(signupFailureMessage(null)).toBe("Something went wrong. Please try again.");
  });
});
