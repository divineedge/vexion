import { describe, expect, it } from "vitest";
import {
  CHEMICAL_RECORD_REQUIREMENT_KEYS,
  DEFAULT_CHEMICAL_RECORD_REQUIREMENTS,
  normalizeChemicalRecordRequirements,
  parseChemicalRecordRequirements,
  parseStrictChemicalAppliedAt,
  validateChemicalRecordRequirements,
  validateSuppliedChemicalApplicationFields,
} from "./chemicalRequirements";

describe("chemical record requirements", () => {
  it("normalizes a saved settings object to every known configurable field", () => {
    const saved = Object.fromEntries(
      CHEMICAL_RECORD_REQUIREMENT_KEYS.map((key, index) => [key, index % 2 === 0]),
    );

    expect(normalizeChemicalRecordRequirements(saved)).toEqual(saved);
    expect(normalizeChemicalRecordRequirements({ targetPest: true, ignored: true })).toEqual({
      ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS,
      targetPest: true,
    });
    expect(normalizeChemicalRecordRequirements(null)).toEqual(DEFAULT_CHEMICAL_RECORD_REQUIREMENTS);
  });

  it("rejects malformed settings instead of silently accepting them", () => {
    expect(parseChemicalRecordRequirements([])).toBeNull();
    expect(parseChemicalRecordRequirements({ unknown: true })).toBeNull();
    expect(parseChemicalRecordRequirements({ targetPest: "true" })).toBeNull();
    expect(parseChemicalRecordRequirements({ targetPest: true })).toEqual({
      ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS,
      targetPest: true,
    });
  });

  it("requires every configurable field and its companion area unit", () => {
    const requirements = Object.fromEntries(
      CHEMICAL_RECORD_REQUIREMENT_KEYS.map(key => [key, true]),
    ) as typeof DEFAULT_CHEMICAL_RECORD_REQUIREMENTS;

    expect(validateChemicalRecordRequirements({}, requirements)).toEqual({
      treatedArea: "Treated area must be a positive number",
      areaUnit: "Area unit is required when treated area is required",
      treatedZoneName: "Treated zone or location is required",
      targetPest: "Target pest or weed is required",
      applicationMethod: "Application method is required",
      windSpeed: "Wind speed must be zero or greater",
      windDirection: "Wind direction is required",
      temperature: "Temperature must be a valid number",
      applicatorName: "Applicator name is required",
      applicatorLicenseNumber: "Applicator license number is required",
      notes: "Notes are required",
    });

    expect(validateChemicalRecordRequirements({
      treatedArea: "5000",
      areaUnit: "sqft",
      treatedZoneName: "Front lawn",
      targetPest: "Grubs",
      applicationMethod: "Spray",
      windSpeed: "0",
      windDirection: "Calm",
      temperature: "32",
      applicatorName: "Alex",
      applicatorLicenseNumber: "LIC-1",
      notes: "Applied evenly",
    }, requirements)).toEqual({});
  });

  it("rejects whitespace-only text and invalid supplied numeric values", () => {
    expect(validateSuppliedChemicalApplicationFields({
      volumeUnit: " ",
      areaUnit: "\t",
      treatedZoneName: " ",
      targetPest: "\n",
      applicationMethod: " ",
      windDirection: " ",
      applicatorName: " ",
      applicatorLicenseNumber: " ",
      notes: " ",
      treatedArea: "not-a-number",
      windSpeed: "-1",
      temperature: " ",
    })).toEqual({
      volumeUnit: "Volume unit cannot be blank",
      areaUnit: "Area unit cannot be blank",
      treatedZoneName: "Treated zone or location cannot be blank",
      targetPest: "Target pest or weed cannot be blank",
      applicationMethod: "Application method cannot be blank",
      windDirection: "Wind direction cannot be blank",
      applicatorName: "Applicator name cannot be blank",
      applicatorLicenseNumber: "Applicator license number cannot be blank",
      notes: "Notes cannot be blank",
      treatedArea: "Treated area must be a positive number",
      windSpeed: "Wind speed must be zero or greater",
      temperature: "Temperature must be a valid number",
    });
  });

  it("accepts only complete ISO timestamps with an explicit timezone", () => {
    expect(parseStrictChemicalAppliedAt("2026-08-30T14:30:00Z")).toBeInstanceOf(Date);
    expect(parseStrictChemicalAppliedAt("2026-08-30T14:30:00.123-04:00")).toBeInstanceOf(Date);

    for (const value of [
      "2026-08-30T14:30",
      "2026-08-30 14:30:00Z",
      "2026-02-29T14:30:00Z",
      "2026-08-30T24:00:00Z",
      "2026-08-30T14:60:00Z",
      "2026-08-30T14:30:00",
      "not-a-date",
      123,
      null,
    ]) {
      expect(parseStrictChemicalAppliedAt(value)).toBeNull();
    }
  });
});