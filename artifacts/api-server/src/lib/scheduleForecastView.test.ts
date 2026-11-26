import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultForecastView, normalizeForecastView } from "./scheduleForecastView";

describe("schedule forecast view", () => {
  it("keeps a full day open until the user chooses otherwise", () => {
    expect(defaultForecastView()).toEqual({
      startHour: 0,
      endHour: 23,
      hourlyMinimized: false,
      minimizedDays: [],
    });
  });

  it("accepts an hour window, a minimized hourly forecast, and minimized days", () => {
    expect(normalizeForecastView({
      startHour: 7,
      endHour: 17,
      hourlyMinimized: true,
      minimizedDays: ["2026-11-26", "2026-11-26", "2026-11-27"],
    })).toEqual({
      startHour: 7,
      endHour: 17,
      hourlyMinimized: true,
      minimizedDays: ["2026-11-26", "2026-11-27"],
    });
  });

  it("rejects an hour window that runs backwards or a day that is not a date", () => {
    expect(normalizeForecastView({ startHour: 18, endHour: 6, hourlyMinimized: false, minimizedDays: [] })).toBeNull();
    expect(normalizeForecastView({ startHour: 8, endHour: 16, hourlyMinimized: false, minimizedDays: ["Monday"] })).toBeNull();
    expect(normalizeForecastView({ startHour: 8.5, endHour: 16, hourlyMinimized: false, minimizedDays: [] })).toBeNull();
  });

  it("installs the forecast view table without rewriting existing rows", () => {
    const migration = readFileSync(new URL("../../../../lib/db/drizzle/0118_schedule_forecast_view.sql", import.meta.url), "utf8");
    const startup = readFileSync(new URL("./schemaSafety.ts", import.meta.url), "utf8");
    const compact = (sql: string) => sql.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
    const statements = migration.split(";").map(compact).filter(Boolean);
    expect(statements.every(statement => statement.includes("IF NOT EXISTS"))).toBe(true);
    for (const statement of statements) expect(compact(startup)).toContain(statement);
  });
});
