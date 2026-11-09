const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export type CurrentConditions = {
  temperatureF: number | null;
  windMph: number | null;
  windDirection: string | null;
  humidityPct: number | null;
  precipitationChance: number | null;
  rainStatus: "dry" | "rain";
  source: "Open-Meteo";
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function compassFromDegrees(value: number | null): string | null {
  if (value == null) return null;
  const index = Math.round(((value % 360) + 360) % 360 / 45) % 8;
  return DIRECTIONS[index];
}

export function parseCurrentConditions(payload: unknown): CurrentConditions | null {
  const current = payload && typeof payload === "object" ? (payload as { current?: Record<string, unknown> }).current : null;
  if (!current) return null;
  const precipitation = numberOrNull(current.precipitation);
  const chance = numberOrNull(current.precipitation_probability);
  return {
    temperatureF: numberOrNull(current.temperature_2m),
    windMph: numberOrNull(current.wind_speed_10m),
    windDirection: compassFromDegrees(numberOrNull(current.wind_direction_10m)),
    humidityPct: numberOrNull(current.relative_humidity_2m),
    precipitationChance: chance,
    rainStatus: (precipitation ?? 0) > 0 || (chance ?? 0) >= 50 ? "rain" : "dry",
    source: "Open-Meteo",
  };
}

export async function fetchCurrentConditions(lat: number, lng: number): Promise<CurrentConditions | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(5));
  url.searchParams.set("longitude", lng.toFixed(5));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("timezone", "UTC");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return parseCurrentConditions(await response.json());
}
