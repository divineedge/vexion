export function isMissingColumnError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42703" || /column ["\w.]* does not exist/i.test(message);
}
