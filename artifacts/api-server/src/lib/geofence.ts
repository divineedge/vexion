/** Geofence calculations are kept pure so API validation is straightforward to test. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isInsideGeofence(distanceMeters: number, radiusMeters: number): boolean {
  return Number.isFinite(distanceMeters) && Number.isFinite(radiusMeters) && radiusMeters > 0 && distanceMeters <= radiusMeters;
}

export const GEOFENCE_ENTRY_DEBOUNCE_MS = 5 * 60 * 1000;

export function isDuplicateGeofenceEntry(recentEnteredAt: Date | null, now: Date): boolean {
  return recentEnteredAt != null && recentEnteredAt.getTime() >= now.getTime() - GEOFENCE_ENTRY_DEBOUNCE_MS;
}

export function hasExactlyOneWorkLink(jobId: number | null, visitId: number | null): boolean {
  return (jobId != null) !== (visitId != null);
}

export function isAssignedToWork(assigneeId: number | null, isCrewMember: boolean, callerId: number): boolean {
  return assigneeId === callerId || isCrewMember;
}

export function isWithinScheduleDay(scheduledAt: Date | null, now: Date): boolean {
  if (!scheduledAt) return false;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return scheduledAt >= start && scheduledAt <= end;
}