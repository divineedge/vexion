import { describe, it, expect, vi } from "vitest";
import { createScheduleForecastLoader, forecastDateKey, parseScheduleForecast, type ForecastLocation } from "./scheduleWeather";

const instant = Date.parse("2026-10-19T16:00:00Z");
const location: ForecastLocation = { tenantId: 1, propertyId: 2, address: "Weather fixture", lat: 40, lng: -105, timezone: "America/Denver" };
function provider(now = instant) {
  const today = forecastDateKey(now, location.timezone);
  const dates = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
  return {
    daily: {
      time: dates, weather_code: dates.map(() => 0), temperature_2m_max: dates.map(() => 67),
      temperature_2m_min: dates.map(() => 42), precipitation_probability_max: dates.map(() => 0),
      precipitation_sum: dates.map(() => 0), wind_speed_10m_max: dates.map(() => 8),
      wind_gusts_10m_max: dates.map(() => 16), wind_direction_10m_dominant: dates.map(() => 270),
    },
    hourly: {
      time: dates.flatMap(date => Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, "0")}:00`)),
      temperature_2m: [55], relative_humidity_2m: [65], precipitation_probability: [10],
      precipitation: [0], wind_speed_10m: [3], wind_gusts_10m: [8], wind_direction_10m: [180],
    },
  };
}

describe("Scheduler weather normalization", () => {
  it("uses the company's calendar day, not UTC or the server calendar", () => {
    expect(forecastDateKey(Date.parse("2026-10-19T01:00:00Z"), "America/Denver")).toBe("2026-10-18");
    expect(forecastDateKey(Date.parse("2026-10-19T23:30:00Z"), "Pacific/Auckland")).toBe("2026-10-20");
  });
  it("preserves fourteen calendar dates, the map pin, units and hourly readings", () => {
    const data = parseScheduleForecast(provider(), location, instant);
    expect(data.daily).toHaveLength(14);
    expect(data.daily[0]).toMatchObject({ date: "2026-10-19", highF: 67, rainProbability: 0, windMph: 8, gustMph: 16 });
    expect(data.daily[13].date).toBe("2026-11-01");
    expect(data.hourly).toHaveLength(336);
    expect(data.hourly[0]).toMatchObject({ time: "2026-10-19T00:00", humidityPct: 65, windDirectionDeg: 180 });
    expect(data).toMatchObject({ latitude: 40, longitude: -105, timezone: "America/Denver", source: "Open-Meteo" });
  });
  it("does not turn missing readings into calm/dry conditions", () => {
    const raw = provider();
    raw.daily.precipitation_probability_max = [];
    raw.daily.wind_speed_10m_max = [];
    const data = parseScheduleForecast(raw, location, instant);
    expect(data.daily[0].rainProbability).toBeNull();
    expect(data.daily[0].windMph).toBeNull();
    expect(data.hourly[1].humidityPct).toBeNull();
  });
  it("rejects invalid meteorological ranges while preserving genuine zeroes", () => {
    const raw = provider();
    raw.daily.precipitation_probability_max = [101, -1, 0];
    raw.daily.precipitation_sum = [-2, 0];
    raw.hourly.relative_humidity_2m = [150];
    const data = parseScheduleForecast(raw, location, instant);
    expect(data.daily.map(d => d.rainProbability).slice(0, 3)).toEqual([null, null, 0]);
    expect(data.daily[0].precipitationIn).toBeNull();
    expect(data.daily[1].precipitationIn).toBe(0);
    expect(data.hourly[0].humidityPct).toBeNull();
  });
  it("rejects incomplete, old or malformed forecasts instead of shifting them to the selected schedule day", () => {
    expect(() => parseScheduleForecast(provider(instant - 86400000), location, instant)).toThrow();
    const raw = provider(); raw.daily.time.pop();
    expect(() => parseScheduleForecast(raw, location, instant)).toThrow();
    expect(() => parseScheduleForecast({ error: true }, location, instant)).toThrow();
    const empty = provider(); empty.hourly.time = [];
    expect(() => parseScheduleForecast(empty, location, instant)).toThrow();
  });
});

describe("Scheduler forecast loading and freshness", () => {
  it("requests a real fourteen-day/hourly forecast at the saved pin in company time with explicit units", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(provider())));
    const load = createScheduleForecastLoader({ fetcher, now: () => instant });
    await load(location);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.hostname).toBe("api.open-meteo.com");
    for (const [key, value] of Object.entries({ latitude: "40", longitude: "-105", forecast_days: "14", timezone: "America/Denver", wind_speed_unit: "mph", temperature_unit: "fahrenheit", precipitation_unit: "inch" })) {
      expect(url.searchParams.get(key)).toBe(value);
    }
    expect(url.searchParams.get("hourly")).toContain("relative_humidity_2m");
  });
  it("coalesces simultaneous requests and caches only while fresh", async () => {
    let clock = instant;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(provider(clock))));
    const load = createScheduleForecastLoader({ fetcher, now: () => clock });
    await Promise.all([load(location), load(location)]);
    await load(location); expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 21 * 60 * 1000;
    await load(location); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("isolates company, property, changed pin and timezone caches", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(provider())));
    const load = createScheduleForecastLoader({ fetcher, now: () => instant });
    await load(location);
    await load({ ...location, tenantId: 9 });
    await load({ ...location, propertyId: 10 });
    await load({ ...location, lat: 41 });
    await load({ ...location, timezone: "America/New_York" });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("refreshes across company midnight even when the twenty-minute TTL has not elapsed", async () => {
    let clock = Date.parse("2026-10-20T05:55:00Z");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(provider(clock))));
    const load = createScheduleForecastLoader({ fetcher, now: () => clock });
    expect((await load(location)).daily[0].date).toBe("2026-10-19");
    clock += 10 * 60 * 1000;
    expect((await load(location)).daily[0].date).toBe("2026-10-20");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not serve stale cached weather when refresh fails, and allows retry", async () => {
    let clock = instant;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(provider())))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockImplementation(async () => new Response(JSON.stringify(provider(clock))));
    const load = createScheduleForecastLoader({ fetcher, now: () => clock });
    await load(location); clock += 21 * 60 * 1000;
    await expect(load(location)).rejects.toThrow("503");
    await expect(load(location)).resolves.toHaveProperty("source", "Open-Meteo");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
