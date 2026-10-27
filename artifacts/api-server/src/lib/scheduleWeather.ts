import type { ScheduleForecast } from "@workspace/api-client-react";
import { z } from "zod";

const FORECAST_TTL = 20 * 60 * 1000;
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const providerSchema = z.object({
  daily: z.object({ time: z.array(calendarDate).length(14) }).catchall(z.array(z.unknown())),
  hourly: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)).min(1),
  }).catchall(z.array(z.unknown())),
});

export interface ForecastLocation {
  tenantId: number;
  propertyId: number | null;
  address: string;
  lat: number;
  lng: number;
  timezone: string;
}

export function forecastDateKey(now: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-");
}

const reading = (series: unknown, index: number, min = -Infinity, max = Infinity): number | null => {
  const value: unknown = Array.isArray(series) ? series[index] : null;
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
};

/** Reject an incomplete/old forecast rather than silently presenting it as a fresh fourteen days. */
export function parseScheduleForecast(raw: unknown, location: ForecastLocation, now: number): ScheduleForecast {
  const parsed = providerSchema.parse(raw);
  const today = forecastDateKey(now, location.timezone);
  const expected = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
  if (parsed.daily.time.some((day, i) => day !== expected[i])) {
    throw new Error("The provider did not return the current fourteen-day forecast");
  }
  const d = parsed.daily, h = parsed.hourly;
  const days = new Set(expected);
  const hours = h.time.map((time, i) => ({
    time,
    temperatureF: reading(h.temperature_2m, i),
    rainProbability: reading(h.precipitation_probability, i, 0, 100),
    precipitationIn: reading(h.precipitation, i, 0),
    windMph: reading(h.wind_speed_10m, i, 0),
    gustMph: reading(h.wind_gusts_10m, i, 0),
    windDirectionDeg: reading(h.wind_direction_10m, i, 0, 360),
    humidityPct: reading(h.relative_humidity_2m, i, 0, 100),
  })).filter(hour => days.has(hour.time.slice(0, 10)));
  if (hours.length === 0) throw new Error("Hourly forecast is unavailable");
  return {
    propertyId: location.propertyId,
    location: location.address,
    latitude: location.lat,
    longitude: location.lng,
    timezone: location.timezone,
    fetchedAt: new Date(now).toISOString(),
    source: "Open-Meteo",
    daily: d.time.map((date, i) => ({
      date, weatherCode: reading(d.weather_code, i, 0),
      highF: reading(d.temperature_2m_max, i), lowF: reading(d.temperature_2m_min, i),
      rainProbability: reading(d.precipitation_probability_max, i, 0, 100),
      precipitationIn: reading(d.precipitation_sum, i, 0),
      windMph: reading(d.wind_speed_10m_max, i, 0),
      gustMph: reading(d.wind_gusts_10m_max, i, 0),
      windDirectionDeg: reading(d.wind_direction_10m_dominant, i, 0, 360),
    })),
    hourly: hours,
  };
}

/** Company/pin/timezone/date scoped, bounded cache; never serve expired weather after a provider error. */
export function createScheduleForecastLoader({
  fetcher = fetch, now = Date.now,
}: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, { expires: number; forecast: ScheduleForecast }>();
  const pending = new Map<string, Promise<ScheduleForecast>>();
  return async (location: ForecastLocation): Promise<ScheduleForecast> => {
    const key = JSON.stringify([location, forecastDateKey(now(), location.timezone)]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.forecast;
    cache.delete(key);
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      const params = new URLSearchParams({
        latitude: String(location.lat), longitude: String(location.lng),
        timezone: location.timezone, forecast_days: "14",
        temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
        hourly: "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
      });
      const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`Forecast provider returned ${response.status}`);
      const forecast = parseScheduleForecast(await response.json(), location, now());
      // Evict expired entries first and bound memory even if many properties are visited.
      for (const [entryKey, entry] of cache) if (entry.expires <= now()) cache.delete(entryKey);
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { forecast, expires: now() + FORECAST_TTL });
      return forecast;
    })();
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  };
}

export const loadScheduleForecast = createScheduleForecastLoader();
