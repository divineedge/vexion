export type MeasurementCapture = "area" | "linear" | "both";

export interface SectionMeasurement {
  areaSqft: number;
  lengthFt: number;
  area_sqft: number;
  perimeter_linear_feet: number;
}

const EARTH_RADIUS_M = 6371000;
const SQM_TO_SQFT = 10.7639;
const M_TO_FT = 3.28084;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Open path length in feet. */
export function pathLengthFt(vertices: [number, number][]): number {
  if (vertices.length < 2) return 0;
  let totalM = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const [lat1, lng1] = vertices[i];
    const [lat2, lng2] = vertices[i + 1];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    totalM += EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return totalM * M_TO_FT;
}

/** Closed ring length in feet, including the edge back to the first point. */
export function closedPerimeterFt(vertices: [number, number][]): number {
  if (vertices.length < 2) return 0;
  const ring = vertices.length >= 3 ? [...vertices, vertices[0]] : vertices;
  return pathLengthFt(ring as [number, number][]);
}

/** Shoelace area in square feet. */
export function polygonAreaSqft(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0;
  const centerLat = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length;
  const cosLat = Math.cos(toRad(centerLat));
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const xi = vertices[i][1] * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
    const yi = vertices[i][0] * EARTH_RADIUS_M * (Math.PI / 180);
    const xj = vertices[j][1] * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
    const yj = vertices[j][0] * EARTH_RADIUS_M * (Math.PI / 180);
    area += xi * yj - xj * yi;
  }
  return (Math.abs(area) / 2) * SQM_TO_SQFT;
}

/** Area and perimeter for one drawn section. Linear sections keep area at 0. */
export function measureSection(vertices: [number, number][], mode: MeasurementCapture): SectionMeasurement {
  const areaSqft = mode === "linear" ? 0 : polygonAreaSqft(vertices);
  const lengthFt = mode === "linear" ? pathLengthFt(vertices) : closedPerimeterFt(vertices);
  return {
    areaSqft,
    lengthFt,
    area_sqft: areaSqft,
    perimeter_linear_feet: lengthFt,
  };
}

export function formatArea(sqft: number, unit: "sqft" | "acres" = "sqft"): string {
  if (unit === "acres") return `${(sqft / 43560).toFixed(3)} ac`;
  return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`;
}

export function formatLinearFeet(feet: number): string {
  return `${feet.toLocaleString(undefined, { maximumFractionDigits: 0 })} linear ft`;
}
