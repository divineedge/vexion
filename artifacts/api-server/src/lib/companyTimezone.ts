export const DEFAULT_COMPANY_TIMEZONE = "America/Denver";

export function companyTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_COMPANY_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_COMPANY_TIMEZONE;
  }
}
