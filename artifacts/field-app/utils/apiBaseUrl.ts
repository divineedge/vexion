/** Production API. Used when EXPO_PUBLIC_API_BASE_URL and VITE_API_BASE_URL are unset. */
export const PRODUCTION_API_URL = "https://workspaceapi-server-production-21ea.up.railway.app";

/**
 * Base URL for every field-app API request, including
 * `${API_URL}/api/auth/signup`, login, session refresh, and logout.
 */
export function resolveApiBaseUrl(): string {
  const API_URL = process.env.EXPO_PUBLIC_API_BASE_URL
    || process.env.VITE_API_BASE_URL
    || PRODUCTION_API_URL;
  const trimmed = API_URL.trim().replace(/\/+$/, "");
  return trimmed || PRODUCTION_API_URL;
}

/** Absolute URL for a relative API path such as `/api/auth/signup`. */
export function apiUrl(path: string): string {
  const API_URL = resolveApiBaseUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_URL}${suffix}`;
}
