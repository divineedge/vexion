import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHEMICAL_RECORD_REQUIREMENTS,
  normalizeChemicalRecordRequirements,
} from "./chemicalRequirements";

const logFormSource = readFileSync(
  new URL("../app/(app)/log/[jobId].tsx", import.meta.url),
  "utf8",
);

describe("Field App chemical requirement form", () => {
  it("loads every saved tenant requirement into the form", () => {
    const keys = Object.keys(DEFAULT_CHEMICAL_RECORD_REQUIREMENTS) as Array<
      keyof typeof DEFAULT_CHEMICAL_RECORD_REQUIREMENTS
    >;
    const saved = Object.fromEntries(keys.map(key => [key, true]));
    const normalized = normalizeChemicalRecordRequirements(saved);

    expect(Object.keys(normalized)).toEqual(keys);
    expect(Object.values(normalized)).toEqual(keys.map(() => true));
    expect(logFormSource).toContain(
      "normalizeChemicalRecordRequirements(tenantSettings?.chemicalRecordRequirements)",
    );

    for (const key of keys) {
      expect(logFormSource).toContain(`required={chemicalRequirements.${key}}`);
      expect(logFormSource).toContain(`chemicalRequirements.${key}`);
    }
  });

  it("keeps missing or malformed saved flags optional", () => {
    expect(normalizeChemicalRecordRequirements({
      targetPest: true,
      notes: "true",
      unexpected: true,
    })).toEqual({
      ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS,
      targetPest: true,
    });
  });
});