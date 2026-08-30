export type ChemicalRecordRequirements = {
  treatedArea: boolean;
  treatedZoneName: boolean;
  targetPest: boolean;
  applicationMethod: boolean;
  windSpeed: boolean;
  windDirection: boolean;
  temperature: boolean;
  applicatorName: boolean;
  applicatorLicenseNumber: boolean;
  notes: boolean;
};

export const DEFAULT_CHEMICAL_RECORD_REQUIREMENTS: ChemicalRecordRequirements = {
  treatedArea: false,
  treatedZoneName: false,
  targetPest: false,
  applicationMethod: false,
  windSpeed: false,
  windDirection: false,
  temperature: false,
  applicatorName: false,
  applicatorLicenseNumber: false,
  notes: false,
};

export function normalizeChemicalRecordRequirements(value: unknown): ChemicalRecordRequirements {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.keys(DEFAULT_CHEMICAL_RECORD_REQUIREMENTS).reduce((result, key) => {
    const requirementKey = key as keyof ChemicalRecordRequirements;
    result[requirementKey] = raw[key] === true;
    return result;
  }, { ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS });
}