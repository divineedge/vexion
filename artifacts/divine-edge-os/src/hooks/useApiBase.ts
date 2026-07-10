/**
 * Returns the base URL prefix for the API.
 * Handles the Replit proxy path-prefix routing.
 */
export function useApiBase(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  // Remove trailing slash so we can append /api
  const clean = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${clean}/api`;
}
