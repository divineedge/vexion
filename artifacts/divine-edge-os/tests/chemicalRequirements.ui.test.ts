import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHEMICAL_REQUIREMENT_GROUPS,
  CHEMICAL_REQUIREMENT_KEYS,
  normalizeChemicalRecordRequirements,
} from "../src/lib/chemicalRequirements";

const chemicalsPageSource = readFileSync(
  new URL("../src/pages/chemicals.tsx", import.meta.url),
  "utf8",
);
const schedulePageSource = readFileSync(
  new URL("../src/pages/schedule.tsx", import.meta.url),
  "utf8",
);

describe("web chemical requirement forms", () => {
  it("loads every saved requirement into the settings switches", () => {
    const saved = Object.fromEntries(
      CHEMICAL_REQUIREMENT_KEYS.map(key => [key, true]),
    );
    const normalized = normalizeChemicalRecordRequirements(saved);

    expect(Object.keys(normalized)).toEqual(CHEMICAL_REQUIREMENT_KEYS);
    expect(Object.values(normalized)).toEqual(CHEMICAL_REQUIREMENT_KEYS.map(() => true));

    for (const group of CHEMICAL_REQUIREMENT_GROUPS) {
      for (const field of group.fields) {
        expect(chemicalsPageSource).toContain(`id={\`chemical-requirement-\${field.key}\`}`);
        expect(chemicalsPageSource).toContain(`checked={chemicalRequirements[field.key]}`);
      }
    }
  });

  it("marks every saved requirement in the schedule chemical form", () => {
    for (const key of CHEMICAL_REQUIREMENT_KEYS) {
      expect(schedulePageSource).toContain(`chemicalFieldIsRequired('${key}')`);
      expect(schedulePageSource).toContain(`chemicalRequirements.${key}`);
    }
    expect(schedulePageSource).toContain(
      "normalizeChemicalRecordRequirements(settings?.chemicalRecordRequirements)",
    );
  });
});