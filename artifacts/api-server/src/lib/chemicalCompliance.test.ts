import { describe, expect, it } from "vitest";
import { companyTimezone } from "./companyTimezone";
import { coerceChemicalRecordConfig, defaultChemicalRecordConfig, legacyRequirementsFromConfig, validateConfiguredChemicalRecord } from "./chemicalRecordConfig";
import { compassFromDegrees, parseCurrentConditions } from "./currentWeather";

describe("company timezone and chemical compliance", () => {
  it("falls back when the company timezone is missing or invalid", () => {
    expect(companyTimezone(null)).toBe("America/Denver");
    expect(companyTimezone("Not/AZone")).toBe("America/Denver");
    expect(companyTimezone("America/Chicago")).toBe("America/Chicago");
  });

  it("keeps legacy required flags and lets a new field be hidden", () => {
    const config = coerceChemicalRecordConfig(
      { fields: { humidity: "hidden", treatedArea: "optional" }, customFields: [{ id: "nozzle", label: "Nozzle type", type: "text", status: "required" }] },
      { treatedArea: true, temperature: true },
    );
    expect(config.fields.treatedArea).toBe("optional");
    expect(config.fields.temperature).toBe("required");
    expect(config.fields.humidity).toBe("hidden");
    expect(config.fields.volumeApplied).toBe("required");
    expect(legacyRequirementsFromConfig(config).temperature).toBe(true);
    expect(legacyRequirementsFromConfig(config).treatedArea).toBe(false);
    const errors = validateConfiguredChemicalRecord({ customFieldValues: {} }, config);
    expect(errors.temperature).toBeTruthy();
    expect(errors.humidity).toBeUndefined();
    expect(errors["custom:nozzle"]).toBeTruthy();
    expect(validateConfiguredChemicalRecord({ temperature: 70, customFieldValues: { nozzle: "TeeJet" } }, config)["custom:nozzle"]).toBeUndefined();
  });

  it("returns an empty custom list for a missing document", () => {
    expect(defaultChemicalRecordConfig(null).customFields).toEqual([]);
  });

  it("reads an Open-Meteo current observation", () => {
    expect(compassFromDegrees(0)).toBe("N");
    expect(compassFromDegrees(180)).toBe("S");
    const conditions = parseCurrentConditions({ current: { temperature_2m: 72.4, wind_speed_10m: 6, wind_direction_10m: 90, relative_humidity_2m: 40, precipitation: 0, precipitation_probability: 10 } });
    expect(conditions).toMatchObject({ temperatureF: 72.4, windDirection: "E", humidityPct: 40, rainStatus: "dry" });
    expect(parseCurrentConditions({})).toBeNull();
  });
});
