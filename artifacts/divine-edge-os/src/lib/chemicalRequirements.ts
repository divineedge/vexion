export const CHEMICAL_REQUIREMENT_KEYS = [
  'treatedArea',
  'treatedZoneName',
  'targetPest',
  'applicationMethod',
  'windSpeed',
  'windDirection',
  'temperature',
  'applicatorName',
  'applicatorLicenseNumber',
  'notes',
] as const;

export type ChemicalRequirementKey = typeof CHEMICAL_REQUIREMENT_KEYS[number];
export type ChemicalRecordRequirements = Record<ChemicalRequirementKey, boolean>;

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
  return CHEMICAL_REQUIREMENT_KEYS.reduce((result, key) => {
    result[key] = raw[key] === true;
    return result;
  }, { ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS });
}

export const CHEMICAL_REQUIREMENT_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<{ key: ChemicalRequirementKey; label: string; description: string }>;
}> = [
  {
    title: 'Treatment details',
    description: 'Information about where, why, and how the chemical was applied.',
    fields: [
      { key: 'treatedArea', label: 'Treated area and unit', description: 'Requires a positive treated-area measurement and its unit.' },
      { key: 'treatedZoneName', label: 'Treated zone or location', description: 'Requires a named property zone or a typed location.' },
      { key: 'targetPest', label: 'Target pest or weed', description: 'Requires the reason for the treatment.' },
      { key: 'applicationMethod', label: 'Application method', description: 'Requires spray, granular, drench, or another method.' },
    ],
  },
  {
    title: 'Environmental conditions',
    description: 'Weather conditions recorded at the time of application.',
    fields: [
      { key: 'windSpeed', label: 'Wind speed', description: 'Requires a wind speed of zero or greater.' },
      { key: 'windDirection', label: 'Wind direction', description: 'Requires a compass direction or calm condition.' },
      { key: 'temperature', label: 'Temperature', description: 'Requires a valid temperature reading.' },
    ],
  },
  {
    title: 'Applicator and notes',
    description: 'Information identifying the applicator and any extra record notes.',
    fields: [
      { key: 'applicatorName', label: 'Applicator name', description: 'Requires the person who performed the application.' },
      { key: 'applicatorLicenseNumber', label: 'Applicator license number', description: 'Requires the applicator’s pesticide license number.' },
      { key: 'notes', label: 'Notes', description: 'Requires an additional record note.' },
    ],
  },
];