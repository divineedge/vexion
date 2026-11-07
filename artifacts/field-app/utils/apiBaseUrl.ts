export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://workspaceapi-server-production-21ea.up.railway.app';

/** Absolute URL for a relative API path such as `/api/auth/signup`. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL.replace(/\/+$/, '')}${suffix}`;
}
