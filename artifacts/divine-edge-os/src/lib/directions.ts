/** Google Maps directions links that prefer persisted pins (lat/lng) over address text. */
export type DirectionsTarget = {
  lat?: number | string | null;
  lng?: number | string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "lat,lng" when a valid pin exists, else the joined address, else null. */
export function directionsPoint(t: DirectionsTarget): string | null {
  const lat = num(t.lat), lng = num(t.lng);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return `${lat},${lng}`;
  const addr = [t.address, t.city, t.state, t.zip].map(s => (s ?? '').trim()).filter(Boolean).join(', ');
  return addr || null;
}

export function directionsUrl(t: DirectionsTarget): string | null {
  const p = directionsPoint(t);
  return p ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p)}` : null;
}

/** Multi-stop route: last stop is destination, earlier ones pinned waypoints (Google caps at ~9). */
export function routeDirectionsUrl(stops: DirectionsTarget[]): string | null {
  const pts = stops.map(directionsPoint).filter((p): p is string => !!p);
  if (pts.length === 0) return null;
  const dest = pts[pts.length - 1];
  const waypoints = pts.slice(0, -1);
  let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  if (waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
  return url;
}
