const meta = import.meta as ImportMeta & { env?: ImportMetaEnv };
if (!meta.env) meta.env = {};

const BASE_URL = import.meta.env.VITE_API_URL || process.env.EXPO_PUBLIC_API_BASE_URL || '';

export { BASE_URL };
export const API_BASE_URL = BASE_URL;

/** Absolute URL for a relative API path such as `/api/auth/signup`. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (!BASE_URL) return suffix;
  return `${BASE_URL.replace(/\/+$/, '')}${suffix}`;
}
