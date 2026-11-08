/** Message shown when signup fails. A 409 or an existing-account error asks the user to sign in. */
export function signupFailureMessage(err: unknown): string {
  const status = typeof err === "object" && err !== null && "status" in err
    ? (err as { status?: unknown }).status
    : undefined;
  const message = typeof err === "object" && err !== null && "message" in err
    ? (err as { message?: unknown }).message
    : undefined;
  const text = typeof message === "string" ? message : undefined;

  if (status === 409 || text?.includes("already exists")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  if (err instanceof TypeError) {
    return "Can't reach the server — check your connection.";
  }
  return text || "Something went wrong. Please try again.";
}
