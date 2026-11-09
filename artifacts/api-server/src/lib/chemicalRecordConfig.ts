export const CHEMICAL_FIELD_STATUSES = ["required", "optional", "hidden"] as const;
export type ChemicalFieldStatus = typeof CHEMICAL_FIELD_STATUSES[number];

export const STANDARD_CHEMICAL_FIELDS = [
  { key: "applicatorName", label: "Applicator name", group: "Applicator" },
  { key: "applicatorLicenseNumber", label: "License / certification number", group: "Applicator" },
  { key: "targetPest", label: "Target pest, weed, or disease", group: "Treatment" },
  { key: "productName", label: "Product trade name", group: "Product" },
  { key: "epaRegNumber", label: "EPA registration number", group: "Product" },
  { key: "activeIngredients", label: "Active ingredient(s)", group: "Product" },
  { key: "concentration", label: "Concentration (%)", group: "Product" },
  { key: "applicationMethod", label: "Application method / equipment", group: "Application" },
  { key: "volumeApplied", label: "Total product quantity", group: "Application" },
  { key: "dilutionRate", label: "Dilution / mix rate", group: "Application" },
  { key: "treatedArea", label: "Total treated area", group: "Application" },
  { key: "treatedZoneName", label: "Treated zone", group: "Application" },
  { key: "appliedAt", label: "Application date", group: "Time" },
  { key: "clockTimes", label: "Clock-in and clock-out", group: "Time" },
  { key: "temperature", label: "Temperature", group: "Weather" },
  { key: "windSpeed", label: "Wind speed", group: "Weather" },
  { key: "windDirection", label: "Wind direction", group: "Weather" },
  { key: "humidity", label: "Relative humidity", group: "Weather" },
  { key: "precipitation", label: "Precipitation / rain chance", group: "Weather" },
  { key: "notes", label: "Notes", group: "Notes" },
] as const;

export type StandardChemicalFieldKey = typeof STANDARD_CHEMICAL_FIELDS[number]["key"];

/** These stay required so an application record always names a product, an amount, and a time. */
export const LOCKED_REQUIRED_FIELDS = ["productName", "volumeApplied", "appliedAt"] as const;

export const CUSTOM_FIELD_TYPES = ["text", "number", "dropdown", "checkbox"] as const;
export type CustomChemicalFieldType = typeof CUSTOM_FIELD_TYPES[number];

export type CustomChemicalField = {
  id: string;
  label: string;
  type: CustomChemicalFieldType;
  status: "required" | "optional";
  options: string[];
};

export type ChemicalRecordConfig = {
  fields: Record<StandardChemicalFieldKey, ChemicalFieldStatus>;
  customFields: CustomChemicalField[];
};

const LEGACY_KEYS = ["treatedArea", "treatedZoneName", "targetPest", "applicationMethod", "windSpeed", "windDirection", "temperature", "applicatorName", "applicatorLicenseNumber", "notes"] as const;

function status(value: unknown): ChemicalFieldStatus | null {
  return value === "required" || value === "optional" || value === "hidden" ? value : null;
}

export function defaultChemicalRecordConfig(legacy?: unknown): ChemicalRecordConfig {
  const raw = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy as Record<string, unknown> : {};
  const fields = {} as Record<StandardChemicalFieldKey, ChemicalFieldStatus>;
  for (const field of STANDARD_CHEMICAL_FIELDS) {
    const legacyValue = raw[field.key];
    fields[field.key] = (LOCKED_REQUIRED_FIELDS as readonly string[]).includes(field.key)
      ? "required"
      : legacyValue === true ? "required" : "optional";
  }
  return { fields, customFields: [] };
}

export function coerceChemicalRecordConfig(value: unknown, legacy?: unknown): ChemicalRecordConfig {
  const base = defaultChemicalRecordConfig(legacy);
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const storedFields = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? raw.fields as Record<string, unknown> : {};
  for (const field of STANDARD_CHEMICAL_FIELDS) {
    const next = status(storedFields[field.key]);
    if (next && !(LOCKED_REQUIRED_FIELDS as readonly string[]).includes(field.key)) base.fields[field.key] = next;
  }
  const custom: CustomChemicalField[] = [];
  if (Array.isArray(raw.customFields)) {
    for (const item of raw.customFields) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label.trim().slice(0, 80) : "";
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : "";
      const type = CUSTOM_FIELD_TYPES.includes(row.type as CustomChemicalFieldType) ? row.type as CustomChemicalFieldType : null;
      if (!label || !id || !type || custom.some(field => field.id === id)) continue;
      const options = type === "dropdown" && Array.isArray(row.options)
        ? row.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0).map(option => option.trim().slice(0, 80)).slice(0, 30)
        : [];
      if (type === "dropdown" && options.length === 0) continue;
      custom.push({ id, label, type, status: row.status === "required" ? "required" : "optional", options });
      if (custom.length === 50) break;
    }
  }
  return { fields: base.fields, customFields: custom };
}

export function legacyRequirementsFromConfig(config: ChemicalRecordConfig): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of LEGACY_KEYS) result[key] = config.fields[key] === "required";
  return result;
}

function present(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

export function validateConfiguredChemicalRecord(input: Record<string, unknown>, config: ChemicalRecordConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  const answers = input.customFieldValues && typeof input.customFieldValues === "object" && !Array.isArray(input.customFieldValues)
    ? input.customFieldValues as Record<string, unknown>
    : {};
  for (const field of STANDARD_CHEMICAL_FIELDS) {
    if (config.fields[field.key] !== "required") continue;
    const value = field.key === "precipitation" ? input.precipitationChance ?? input.precipitation : input[field.key];
    const clocked = field.key === "clockTimes" && (present(input.clockInAt) || present(input.clockOutAt) || present(input.appliedAt));
    if (field.key === "clockTimes" ? !clocked : !present(value)) errors[field.key] = `${field.label} is required`;
  }
  for (const field of config.customFields) {
    if (field.status !== "required") continue;
    const value = answers[field.id];
    const checked = value === true || value === "true";
    if (field.type === "checkbox" ? !checked : !present(value)) errors[`custom:${field.id}`] = `${field.label} is required`;
  }
  return errors;
}

export function fieldIsVisible(config: ChemicalRecordConfig, key: StandardChemicalFieldKey): boolean {
  return config.fields[key] !== "hidden";
}
