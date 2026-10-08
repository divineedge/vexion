export function parseCurrentChemicalWeather(data: unknown, now = Date.now()) {
  const c = data && typeof data === "object" ? (data as { current?: Record<string, unknown> }).current : undefined;
  const observed = typeof c?.time === "string" ? new Date(`${c.time}Z`) : null;
  if (!c || !observed || !Number.isFinite(observed.getTime()) || Math.abs(now - observed.getTime()) > 60 * 60 * 1000 ||
      ![c.temperature_2m, c.wind_speed_10m, c.wind_direction_10m].every(v => typeof v === "number" && Number.isFinite(v)) ||
      Number(c.wind_speed_10m) < 0 || Number(c.wind_direction_10m) < 0 || Number(c.wind_direction_10m) > 360) {
    throw new Error("Current weather is unavailable or stale. Enter observed conditions manually.");
  }
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return {
    observedAt: observed.toISOString(),
    temperature: c.temperature_2m as number,
    windSpeed: c.wind_speed_10m as number,
    windDirection: directions[Math.round((c.wind_direction_10m as number) / 45) % 8],
    source: "Open-Meteo current conditions (estimated); verify on site",
  };
}
