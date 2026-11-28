import { haversineMiles } from "./routeSequencing";

/**
 * Orders unlocked upcoming stops and returns every drive leg, including the
 * return to the shop. GOOGLE_MAPS_API_KEY is read here and is never placed on
 * the result, a log line, or an error sent to the client.
 */

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const AVG_SPEED_MPH = 28;
const METERS_PER_MILE = 1609.344;
const REQUEST_TIMEOUT_MS = 8_000;

export interface OptimizePoint {
  address: string;
  lat?: number | null;
  lng?: number | null;
}

export interface OptimizeStop extends OptimizePoint {
  id: string | number;
  status: string;
  lockedTimeWindow?: boolean;
}

export interface OptimizeLeg {
  fromId: string | number | null;
  toId: string | number | null;
  durationMinutes: number;
  distanceMiles: number;
}

export interface OptimizeResult {
  order: Array<string | number>;
  legs: OptimizeLeg[];
  totalDurationMinutes: number;
  source: "google" | "estimated";
}

interface Geo {
  lat: number;
  lng: number;
}

type FetchLike = typeof fetch;

function upcoming(status: string): boolean {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "upcoming" || normalized === "scheduled" || normalized === "pending";
}

export function isMovableStop(stop: OptimizeStop): boolean {
  return upcoming(stop.status) && !stop.lockedTimeWindow;
}

/** Stable stand-in coordinate when a stop has an address but no pin. */
export function pointFor(place: OptimizePoint): Geo {
  if (place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return { lat: place.lat, lng: place.lng };
  }
  let hash = 2166136261;
  for (const char of place.address.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const east = (Math.imul(unsigned, 2246822519) >>> 0) / 2 ** 32;
  return { lat: 39.75 + (unsigned / 2 ** 32 - 0.5) * 0.4, lng: -104.99 + (east - 0.5) * 0.4 };
}

function estimateLeg(from: Geo, to: Geo): { durationMinutes: number; distanceMiles: number } {
  const miles = haversineMiles(from.lat, from.lng, to.lat, to.lng);
  return {
    distanceMiles: Math.round(miles * 100) / 100,
    durationMinutes: Math.round((miles / AVG_SPEED_MPH) * 60),
  };
}

function nearestNeighbor(stops: OptimizeStop[], origin: Geo): OptimizeStop[] {
  const remaining = stops.slice();
  const ordered: OptimizeStop[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const next = pointFor(stop);
      const distance = haversineMiles(current.lat, current.lng, next.lat, next.lng);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    const chosen = remaining.splice(best, 1)[0];
    ordered.push(chosen);
    current = pointFor(chosen);
  }
  return ordered;
}

/** Locked and already-started stops stay put. Only upcoming unlocked stops move, and they stay inside their gap. */
function orderMovable(stops: OptimizeStop[], origin: OptimizePoint, arrange: (group: OptimizeStop[], from: Geo) => OptimizeStop[]): OptimizeStop[] {
  const ordered = stops.slice();
  let index = 0;
  while (index < ordered.length) {
    if (!isMovableStop(ordered[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < ordered.length && isMovableStop(ordered[index])) index += 1;
    const from = start > 0 ? pointFor(ordered[start - 1]) : pointFor(origin);
    const arranged = arrange(ordered.slice(start, index), from);
    arranged.forEach((stop, offset) => {
      ordered[start + offset] = stop;
    });
  }
  return ordered;
}

function legsFor(ordered: OptimizeStop[], origin: OptimizePoint, destination: OptimizePoint, source: OptimizeResult["source"]): OptimizeResult {
  const places: OptimizePoint[] = [origin, ...ordered, destination];
  const ids: Array<string | number | null> = [null, ...ordered.map(stop => stop.id), null];
  const legs: OptimizeLeg[] = [];
  for (let index = 0; index < places.length - 1; index += 1) {
    legs.push({
      fromId: ids[index],
      toId: ids[index + 1],
      ...estimateLeg(pointFor(places[index]), pointFor(places[index + 1])),
    });
  }
  return {
    order: ordered.map(stop => stop.id),
    legs,
    totalDurationMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
    source,
  };
}

export function estimateRoute(stops: OptimizeStop[], origin: OptimizePoint, destination: OptimizePoint): OptimizeResult {
  const ordered = orderMovable(stops, origin, (group, from) => nearestNeighbor(group, from));
  return legsFor(ordered, origin, destination, "estimated");
}

/** Drive legs for a stop order the dispatcher already chose. Does not move stops. */
export function measureOrder(stops: OptimizeStop[], origin: OptimizePoint, destination: OptimizePoint): OptimizeResult {
  return legsFor(stops, origin, destination, "estimated");
}

function googleLocation(place: OptimizePoint): Record<string, unknown> {
  if (place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return { location: { latLng: { latitude: place.lat, longitude: place.lng } } };
  }
  return { address: place.address || "shop" };
}

function parseSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

interface GoogleLeg {
  durationMinutes: number;
  distanceMiles: number;
}

async function googleRoute(
  origin: OptimizePoint,
  destination: OptimizePoint,
  intermediates: OptimizeStop[],
  optimize: boolean,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<{ order: OptimizeStop[]; legs: GoogleLeg[] } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ROUTES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.legs.duration,routes.legs.distanceMeters,routes.optimizedIntermediateWaypointIndex",
      },
      body: JSON.stringify({
        origin: googleLocation(origin),
        destination: googleLocation(destination),
        intermediates: intermediates.map(stop => googleLocation(stop)),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        optimizeWaypointOrder: optimize,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      routes?: Array<{
        optimizedIntermediateWaypointIndex?: number[];
        legs?: Array<{ duration?: string; distanceMeters?: number }>;
      }>;
    };
    const route = payload.routes?.[0];
    if (!route?.legs || route.legs.length !== intermediates.length + 1) return null;
    let ordered = intermediates;
    if (optimize && intermediates.length > 1) {
      const indexes = route.optimizedIntermediateWaypointIndex;
      if (!indexes || indexes.length !== intermediates.length) return null;
      ordered = indexes.map(index => intermediates[index]);
      if (ordered.some(stop => !stop)) return null;
    }
    const legs: GoogleLeg[] = [];
    for (const leg of route.legs) {
      const seconds = parseSeconds(leg.duration);
      if (seconds == null || !Number.isFinite(leg.distanceMeters)) return null;
      legs.push({
        durationMinutes: Math.round(seconds / 60),
        distanceMiles: Math.round((Number(leg.distanceMeters) / METERS_PER_MILE) * 100) / 100,
      });
    }
    return { order: ordered, legs };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function withGoogleLegs(ordered: OptimizeStop[], measured: GoogleLeg[]): OptimizeResult {
  const ids: Array<string | number | null> = [null, ...ordered.map(stop => stop.id), null];
  const legs = measured.map((leg, index) => ({
    fromId: ids[index],
    toId: ids[index + 1],
    durationMinutes: leg.durationMinutes,
    distanceMiles: leg.distanceMiles,
  }));
  return {
    order: ordered.map(stop => stop.id),
    legs,
    totalDurationMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
    source: "google",
  };
}

async function orderLockedRoute(
  stops: OptimizeStop[],
  origin: OptimizePoint,
  destination: OptimizePoint,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<OptimizeStop[]> {
  const next = stops.slice();
  let index = 0;
  while (index < next.length) {
    if (!isMovableStop(next[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < next.length && isMovableStop(next[index])) index += 1;
    const group = next.slice(start, index);
    if (group.length < 2) continue;
    const from = start > 0 ? next[start - 1] : origin;
    const to = index < next.length ? next[index] : destination;
    const optimized = await googleRoute(from, to, group, true, apiKey, fetchImpl);
    const replacement = optimized?.order ?? nearestNeighbor(group, pointFor(from));
    replacement.forEach((stop, offset) => {
      next[start + offset] = stop;
    });
  }
  return next;
}

export async function optimizeRoute(
  input: { origin: OptimizePoint; destination: OptimizePoint; stops: OptimizeStop[] },
  options?: { fetchImpl?: FetchLike; apiKey?: string | null },
): Promise<OptimizeResult> {
  const { origin, destination, stops } = input;
  const apiKey = options && "apiKey" in options ? options.apiKey?.trim() || null : process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
  const fetchImpl = options?.fetchImpl ?? fetch;
  if (!apiKey) return estimateRoute(stops, origin, destination);

  if (stops.length > 0 && stops.every(isMovableStop)) {
    const direct = await googleRoute(origin, destination, stops, true, apiKey, fetchImpl);
    if (direct) return withGoogleLegs(direct.order, direct.legs);
    return estimateRoute(stops, origin, destination);
  }

  const ordered = await orderLockedRoute(stops, origin, destination, apiKey, fetchImpl);
  const timed = await googleRoute(origin, destination, ordered, false, apiKey, fetchImpl);
  if (timed) return withGoogleLegs(ordered, timed.legs);
  return legsFor(ordered, origin, destination, "estimated");
}
