export type GeofenceUnit = 'm' | 'ft';

const METERS_PER_FOOT = 0.3048;

/** Converts the meter value persisted by the API into the tenant's display unit. */
export function geofenceRadiusForDisplay(radiusMeters: number, unit: GeofenceUnit): number {
  return unit === 'ft' ? Math.round(radiusMeters / METERS_PER_FOOT) : radiusMeters;
}

/** Converts a radius entered in the tenant's display unit into API/persistence meters. */
export function geofenceRadiusToMeters(radius: number, unit: GeofenceUnit): number {
  return unit === 'ft' ? Math.round(radius * METERS_PER_FOOT) : radius;
}