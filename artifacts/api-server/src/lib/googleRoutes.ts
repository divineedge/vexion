/**
 * Server-only Google Routes provider. The API key is intentionally read only
 * here and is never included in an API response or log entry.
 */

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const REQUEST_TIMEOUT_MS = 5_000;

function allowedReferer(): string | null {
  const configuredDomain = process.env.REPLIT_DOMAINS?.split(",").map(domain => domain.trim()).find(Boolean)
    ?? process.env.REPLIT_DEV_DOMAIN?.trim();
  if (!configuredDomain) return null;
  return configuredDomain.startsWith("http://") || configuredDomain.startsWith("https://")
    ? configuredDomain
    : `https://${configuredDomain}`;
}

/** Returns Google road-drive minutes, or null when the provider is unavailable. */
export async function getGoogleDriveMinutes(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
): Promise<number | null> {
  const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  const referer = allowedReferer();
  if (!apiKey || !referer) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ROUTES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration",
        Referer: referer,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const duration = (payload as { routes?: Array<{ duration?: string }> }).routes?.[0]?.duration;
    const seconds = duration ? Number.parseFloat(duration) : Number.NaN;
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds / 60) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}