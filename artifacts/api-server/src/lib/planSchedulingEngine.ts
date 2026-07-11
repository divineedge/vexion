/**
 * Plan Scheduling Engine
 * Pure-ish TypeScript utility for computing when plan visits should land and
 * for clustering new visits with existing same-service jobs that are already
 * scheduled nearby, so a technician spends a day working one job type in one
 * neighborhood instead of criss-crossing the territory.
 *
 * All date math produces UTC Date objects; callers are responsible for
 * persistence. The DB lookup used for clustering is injected so this module
 * stays easily testable and framework-agnostic.
 */

export interface PlanServiceRule {
  serviceId: number;
  serviceName: string;
  /** Days between visits of this service, e.g. 7 = weekly, 42 = every 6 weeks. */
  frequencyDays: number;
}

export interface ClusterCandidate {
  jobId: number;
  scheduledAt: Date;
  assigneeId: number | null;
  assigneeName: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PlanVisitCandidate {
  serviceId: number;
  serviceName: string;
  /** The date this visit actually lands on, after clustering. */
  date: Date;
  /** The date the frequency rule alone would have produced, before snapping. */
  idealDate: Date;
  assigneeId: number | null;
  assigneeName: string | null;
  /** True when this visit was snapped to an existing nearby same-service job's day. */
  clustered: boolean;
}

export interface ClusterLookup {
  /** Returns already-scheduled jobs for this service within the tenant, for clustering comparison. */
  (serviceId: number): Promise<ClusterCandidate[]>;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Length (in days) of one billing period for a given cycle. */
export function billingCycleDays(cycle: string, customDays?: number | null): number {
  switch (cycle) {
    case "monthly": return 30;
    case "quarterly": return 91;
    case "annual": return 365;
    case "custom": return customDays ?? 30;
    default: return 30;
  }
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Given a candidate date, look for an already-scheduled job of the same
 * service within `windowDays` and `radiusMeters` of this property, and if
 * found, snap this visit onto that job's day + technician.
 */
export async function snapToCluster(
  candidates: ClusterCandidate[],
  idealDate: Date,
  windowDays: number,
  radiusMeters: number,
  propertyLat: number | null,
  propertyLng: number | null,
): Promise<{ date: Date; assigneeId: number | null; assigneeName: string | null; clustered: boolean }> {
  if (propertyLat == null || propertyLng == null) {
    return { date: idealDate, assigneeId: null, assigneeName: null, clustered: false };
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  let best: ClusterCandidate | null = null;
  let bestDistance = Infinity;

  for (const c of candidates) {
    if (c.lat == null || c.lng == null) continue;
    const dt = Math.abs(c.scheduledAt.getTime() - idealDate.getTime());
    if (dt > windowMs) continue;
    const distance = haversineMeters(propertyLat, propertyLng, c.lat, c.lng);
    if (distance > radiusMeters) continue;
    // Prefer the closest match; ties broken by smallest date drift.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = c;
    }
  }

  if (best) {
    return { date: best.scheduledAt, assigneeId: best.assigneeId, assigneeName: best.assigneeName, clustered: true };
  }
  return { date: idealDate, assigneeId: null, assigneeName: null, clustered: false };
}

/**
 * Generate a preview of visits for one billing period starting at `startDate`,
 * one entry per service occurrence per its frequency rule, capped at
 * `visitCount` total visits (sorted chronologically) if provided.
 */
export async function generatePlanPreview(params: {
  services: PlanServiceRule[];
  startDate: Date;
  billingCycle: string;
  customCycleDays?: number | null;
  visitCount?: number | null;
  propertyLat: number | null;
  propertyLng: number | null;
  /** ± days allowed when snapping a visit onto a nearby same-service job. Default 3. */
  clusterWindowDays?: number;
  /** Max distance (meters) to consider two jobs "nearby". Default ~1.5 miles. */
  clusterRadiusMeters?: number;
  lookupClusterCandidates: ClusterLookup;
}): Promise<PlanVisitCandidate[]> {
  const {
    services, startDate, billingCycle, customCycleDays, visitCount,
    propertyLat, propertyLng, lookupClusterCandidates,
  } = params;
  const clusterWindowDays = params.clusterWindowDays ?? 3;
  const clusterRadiusMeters = params.clusterRadiusMeters ?? 2414; // ~1.5 miles

  const periodDays = billingCycleDays(billingCycle, customCycleDays);
  const periodEnd = addDays(startDate, periodDays);

  const all: PlanVisitCandidate[] = [];

  for (const service of services) {
    if (service.frequencyDays <= 0) continue;
    const candidates = await lookupClusterCandidates(service.serviceId);

    let idealDate = new Date(startDate);
    while (idealDate < periodEnd) {
      const snapped = await snapToCluster(candidates, idealDate, clusterWindowDays, clusterRadiusMeters, propertyLat, propertyLng);
      all.push({
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        date: snapped.date,
        idealDate: new Date(idealDate),
        assigneeId: snapped.assigneeId,
        assigneeName: snapped.assigneeName,
        clustered: snapped.clustered,
      });
      idealDate = addDays(idealDate, service.frequencyDays);
    }
  }

  all.sort((a, b) => a.date.getTime() - b.date.getTime());

  if (visitCount != null && visitCount > 0 && all.length > visitCount) {
    return all.slice(0, visitCount);
  }
  return all;
}
