export const CHEMICAL_RECORD_REQUIREMENT_KEYS = [
  "treatedArea",
  "treatedZoneName",
  "targetPest",
  "applicationMethod",
  "windSpeed",
  "windDirection",
  "temperature",
  "applicatorName",
  "applicatorLicenseNumber",
  "notes",
] as const;

export type ChemicalRecordRequirementKey = typeof CHEMICAL_RECORD_REQUIREMENT_KEYS[number];
export type ChemicalRecordRequirements = Record<ChemicalRecordRequirementKey, boolean>;

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
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return CHEMICAL_RECORD_REQUIREMENT_KEYS.reduce((result, key) => {
    result[key] = raw[key] === true;
    return result;
  }, { ...DEFAULT_CHEMICAL_RECORD_REQUIREMENTS });
}

export function parseChemicalRecordRequirements(value: unknown): ChemicalRecordRequirements | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(key => !(CHEMICAL_RECORD_REQUIREMENT_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length > 0 || CHEMICAL_RECORD_REQUIREMENT_KEYS.some(key => raw[key] !== undefined && typeof raw[key] !== "boolean")) {
    return null;
  }
  return normalizeChemicalRecordRequirements(raw);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isProvided(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function isNonNegativeNumber(value: unknown): boolean {
  return isProvided(value) && !(typeof value === "string" && !value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function isPositiveNumber(value: unknown): boolean {
  return isProvided(value) && !(typeof value === "string" && !value.trim()) && Number.isFinite(Number(value)) && Number(value) > 0;
}

export function validateSuppliedChemicalApplicationFields(input: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (isProvided(input.treatedArea) && !isPositiveNumber(input.treatedArea)) {
    errors.treatedArea = "Treated area must be a positive number";
  }
  if (isProvided(input.windSpeed) && !isNonNegativeNumber(input.windSpeed)) {
    errors.windSpeed = "Wind speed must be zero or greater";
  }
  if (isProvided(input.temperature) && (!(typeof input.temperature !== "string" || input.temperature.trim()) || !Number.isFinite(Number(input.temperature)))) {
    errors.temperature = "Temperature must be a valid number";
  }
  const textFields = [
    ["volumeUnit", "Volume unit"],
    ["areaUnit", "Area unit"],
    ["treatedZoneName", "Treated zone or location"],
    ["targetPest", "Target pest or weed"],
    ["applicationMethod", "Application method"],
    ["windDirection", "Wind direction"],
    ["applicatorName", "Applicator name"],
    ["applicatorLicenseNumber", "Applicator license number"],
    ["notes", "Notes"],
  ] as const;
  for (const [key, label] of textFields) {
    if (isProvided(input[key]) && !hasText(input[key])) {
      errors[key] = `${label} cannot be blank`;
    }
  }
  return errors;
}

export function parseStrictChemicalAppliedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", fractionText = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateChemicalRecordRequirements(
  input: Record<string, unknown>,
  requirements: ChemicalRecordRequirements,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (requirements.treatedArea && !isPositiveNumber(input.treatedArea)) {
    errors.treatedArea = "Treated area must be a positive number";
  }
  if (requirements.treatedArea && !hasText(input.areaUnit)) {
    errors.areaUnit = "Area unit is required when treated area is required";
  }
  if (requirements.treatedZoneName && !hasText(input.treatedZoneName)) {
    errors.treatedZoneName = "Treated zone or location is required";
  }
  if (requirements.targetPest && !hasText(input.targetPest)) {
    errors.targetPest = "Target pest or weed is required";
  }
  if (requirements.applicationMethod && !hasText(input.applicationMethod)) {
    errors.applicationMethod = "Application method is required";
  }
  if (requirements.windSpeed && !isNonNegativeNumber(input.windSpeed)) {
    errors.windSpeed = "Wind speed must be zero or greater";
  }
  if (requirements.windDirection && !hasText(input.windDirection)) {
    errors.windDirection = "Wind direction is required";
  }
  if (requirements.temperature && (input.temperature === null || input.temperature === undefined || input.temperature === "" || !Number.isFinite(Number(input.temperature)))) {
    errors.temperature = "Temperature must be a valid number";
  }
  if (requirements.applicatorName && !hasText(input.applicatorName)) {
    errors.applicatorName = "Applicator name is required";
  }
  if (requirements.applicatorLicenseNumber && !hasText(input.applicatorLicenseNumber)) {
    errors.applicatorLicenseNumber = "Applicator license number is required";
  }
  if (requirements.notes && !hasText(input.notes)) {
    errors.notes = "Notes are required";
  }
  return errors;
}