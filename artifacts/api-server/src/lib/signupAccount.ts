function field(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Fields a new company owner may send. A business id is never one of them. */
export function signupAccountFields(body: unknown): {
  companyName: string | undefined;
  ownerName: string | undefined;
  email: string | undefined;
  password: string | undefined;
} {
  const source = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    companyName: field(source.companyName),
    ownerName: field(source.ownerName),
    email: field(source.email),
    password: field(source.password),
  };
}
