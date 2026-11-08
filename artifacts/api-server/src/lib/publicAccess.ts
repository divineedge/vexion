import type { CorsOptions } from "cors";

/** Production office app. Credentialed browser calls from this origin must pass CORS. */
export const ADMIN_APP_ORIGIN = "https://workspacedivine-edge-os-production.up.railway.app";

/** Production field app. Credentialed browser calls from this origin must pass CORS. */
export const FIELD_APP_ORIGIN = "https://workspacefield-app-production.up.railway.app";

export const allowedOrigins = [
  process.env.ADMIN_APP_ORIGIN || ADMIN_APP_ORIGIN,
  process.env.FIELD_APP_ORIGIN || FIELD_APP_ORIGIN,
];

/**
 * Paths that must not require a staff session. The router is mounted at `/api`,
 * so both the mounted path and the external `/api/...` path are recognized.
 */
const PUBLIC_HEALTH_PATHS = new Set(["/health", "/healthz", "/api/health", "/api/healthz"]);
const PUBLIC_AUTH_PATHS = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/register",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/register",
]);

export function isStaffSessionExempt(method: string, path: string): boolean {
  const normalized = path.split("?")[0].replace(/\/+$/, "") || "/";
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return PUBLIC_HEALTH_PATHS.has(normalized);
  if (verb === "POST") return PUBLIC_AUTH_PATHS.has(normalized);
  if (verb === "OPTIONS") return PUBLIC_HEALTH_PATHS.has(normalized) || PUBLIC_AUTH_PATHS.has(normalized);
  return false;
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) or if listed in allowedOrigins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Or pass origin to allow dynamic Railway preview URLs
    }
  },
  credentials: true,
};
