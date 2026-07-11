/**
 * Route sequencing & capacity utilities for Crew Routing & Capacity Planning.
 *
 * Sequencing uses a nearest-neighbor heuristic starting and ending at the
 * division's depot — good enough for typical daily stop counts (a handful
 * to a few dozen stops) without external mapping APIs.
 */

export interface RouteStop {
  jobId: number;
  lat: number | null;
  lng: number | null;
  /** Budgeted duration in minutes for this stop */
  durationMinutes: number;
}

export interface SequencedStop extends RouteStop {
  sequenceOrder: number;
  /** Drive minutes from the previous stop (or depot for the first stop) */
  driveMinutesFromPrev: number;
}

const AVG_SPEED_MPH = 28; // conservative in-town average incl. stop lights

/** Haversine distance in miles between two lat/lng points. */
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8; // earth radius in miles
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const a = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function driveMinutes(milesDistance: number): number {
  return (milesDistance / AVG_SPEED_MPH) * 60;
}

/**
 * Sequences stops into an efficient nearest-neighbor visiting order starting
 * and ending at the depot. Stops with no lat/lng are appended at the end
 * (unsequenced — can't be geo-optimized) with zero drive time attributed.
 */
export function sequenceStops(
  depot: { lat: number | null; lng: number | null },
  stops: RouteStop[],
): { sequenced: SequencedStop[]; totalDriveMinutes: number } {
  const geocoded = stops.filter(s => s.lat != null && s.lng != null);
  const ungeocoded = stops.filter(s => s.lat == null || s.lng == null);

  const sequenced: SequencedStop[] = [];
  let totalDriveMinutes = 0;
  let currentLat = depot.lat;
  let currentLng = depot.lng;
  const remaining = [...geocoded];

  let order = 0;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      const dist = currentLat != null && currentLng != null
        ? haversineMiles(currentLat, currentLng, stop.lat!, stop.lng!)
        : 0;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    const legMinutes = currentLat != null && currentLng != null ? driveMinutes(bestDist) : 0;
    totalDriveMinutes += legMinutes;
    sequenced.push({ ...next, sequenceOrder: order++, driveMinutesFromPrev: Math.round(legMinutes) });
    currentLat = next.lat;
    currentLng = next.lng;
  }

  // Return trip to depot (counted toward total drive time, not a stop)
  if (sequenced.length > 0 && depot.lat != null && depot.lng != null && currentLat != null && currentLng != null) {
    totalDriveMinutes += driveMinutes(haversineMiles(currentLat, currentLng, depot.lat, depot.lng));
  }

  for (const stop of ungeocoded) {
    sequenced.push({ ...stop, sequenceOrder: order++, driveMinutesFromPrev: 0 });
  }

  return { sequenced, totalDriveMinutes: Math.round(totalDriveMinutes) };
}

/**
 * Recomputes drive times for a manually-specified stop order (drag-to-reorder),
 * without changing which stop is in which position.
 */
export function recomputeDriveTimesForOrder(
  depot: { lat: number | null; lng: number | null },
  orderedStops: RouteStop[],
): { sequenced: SequencedStop[]; totalDriveMinutes: number } {
  const sequenced: SequencedStop[] = [];
  let totalDriveMinutes = 0;
  let currentLat = depot.lat;
  let currentLng = depot.lng;

  orderedStops.forEach((stop, idx) => {
    let legMinutes = 0;
    if (currentLat != null && currentLng != null && stop.lat != null && stop.lng != null) {
      legMinutes = driveMinutes(haversineMiles(currentLat, currentLng, stop.lat, stop.lng));
    }
    totalDriveMinutes += legMinutes;
    sequenced.push({ ...stop, sequenceOrder: idx, driveMinutesFromPrev: Math.round(legMinutes) });
    if (stop.lat != null && stop.lng != null) {
      currentLat = stop.lat;
      currentLng = stop.lng;
    }
  });

  if (sequenced.length > 0 && depot.lat != null && depot.lng != null && currentLat != null && currentLng != null) {
    totalDriveMinutes += driveMinutes(haversineMiles(currentLat, currentLng, depot.lat, depot.lng));
  }

  return { sequenced, totalDriveMinutes: Math.round(totalDriveMinutes) };
}

export interface CapacitySummary {
  shiftHours: number;
  budgetedJobHours: number;
  driveHours: number;
  usedHours: number;
  openSpaceHours: number;
}

/** Computes the capacity/open-space summary for a route/day. */
export function computeCapacity(shiftHours: number, budgetedJobMinutes: number, totalDriveMinutes: number): CapacitySummary {
  const budgetedJobHours = Math.round((budgetedJobMinutes / 60) * 100) / 100;
  const driveHours = Math.round((totalDriveMinutes / 60) * 100) / 100;
  const usedHours = Math.round((budgetedJobHours + driveHours) * 100) / 100;
  const openSpaceHours = Math.round((shiftHours - usedHours) * 100) / 100;
  return { shiftHours, budgetedJobHours, driveHours, usedHours, openSpaceHours };
}

/** Frequency ↔ week matching: does this route template run on the given date's week? */
export function frequencyMatchesWeek(frequency: string, date: Date, anchorDate: Date): boolean {
  if (frequency === "weekly") return true;
  if (frequency === "monthly") {
    // Runs on the first occurrence of its dayOfWeek in the month
    return date.getDate() <= 7;
  }
  // biweekly_a / biweekly_b — alternate by ISO week parity relative to anchor
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksSinceAnchor = Math.floor((startOfWeekUTC(date).getTime() - startOfWeekUTC(anchorDate).getTime()) / msPerWeek);
  const isEvenWeek = weeksSinceAnchor % 2 === 0;
  if (frequency === "biweekly_a") return isEvenWeek;
  if (frequency === "biweekly_b") return !isEvenWeek;
  return true;
}

function startOfWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}
