/**
 * Base URL for the field app API client.
 * Login, signup, session refresh, and logout all go through customFetch, which
 * prepends this value to relative /api paths.
 * EXPO_PUBLIC_DOMAIN remains the host fallback used by the existing Expo dev setup.
 */
export function resolveApiBaseUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL;
  const trimmed = configured?.trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!domain) return null;
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}
