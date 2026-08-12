/**
 * Weather check helper for rainfast alerts.
 *
 * Uses Open-Meteo (https://open-meteo.com/) — free, no API key required.
 * Returns the earliest hour within the window where precipitation probability
 * meets or exceeds the configured threshold, or null if none found.
 */

import { logger } from "./logger";

export interface RainForecastResult {
  /** ISO timestamp of the earliest hour where rain probability ≥ threshold */
  forecastTime: string;
  /** Rain probability at that hour (0–100) */
  probability: number;
}

/**
 * Checks the Open-Meteo hourly forecast for precipitation probability between
 * now and `windowEnd` at the given coordinates.
 *
 * @param lat           Property latitude
 * @param lng           Property longitude
 * @param windowEnd     End of the rainfast window (rainfastUntil)
 * @param thresholdPct  Minimum rain probability (0–100) to trigger an alert
 * @returns The first risky forecast slot, or null if conditions are clear
 */
export async function checkRainBeforeWindow(
  lat: number,
  lng: number,
  windowEnd: Date,
  thresholdPct: number,
): Promise<RainForecastResult | null> {
  const now = new Date();
  if (windowEnd <= now) return null; // window already closed

  // Open-Meteo only forecasts up to 16 days; cap the request at 7 days for
  // practical accuracy (short-range hourly forecasts are much more reliable).
  const maxForecastMs = 7 * 24 * 60 * 60 * 1000;
  const effectiveEnd = new Date(Math.min(windowEnd.getTime(), now.getTime() + maxForecastMs));

  // Build Open-Meteo API URL
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(5));
  url.searchParams.set("longitude", lng.toFixed(5));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "UTC");

  let data: { hourly?: { time?: string[]; precipitation_probability?: number[] } };
  try {
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, url: url.toString() }, "Open-Meteo request failed");
      return null;
    }
    data = await resp.json() as typeof data;
  } catch (err) {
    logger.warn({ err }, "Open-Meteo fetch error — skipping rainfast weather check");
    return null;
  }

  const times = data?.hourly?.time ?? [];
  const probs = data?.hourly?.precipitation_probability ?? [];

  for (let i = 0; i < times.length; i++) {
    const slotTime = new Date(times[i] + "Z"); // Open-Meteo UTC times lack the Z suffix
    if (slotTime < now) continue;
    if (slotTime > effectiveEnd) break;

    const prob = probs[i] ?? 0;
    if (prob >= thresholdPct) {
      return { forecastTime: slotTime.toISOString(), probability: prob };
    }
  }

  return null;
}
