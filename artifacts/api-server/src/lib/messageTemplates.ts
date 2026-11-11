/** Merge tags, audience filters, and website form visibility. No database import. */

export const MERGE_TAGS = ["customer_first_name", "property_address", "service_name", "company_name"] as const;

export const COMMUNICATION_CATEGORIES = [
  "quick_reply",
  "appointment_reminder",
  "delay_notice",
  "pre_service",
  "follow_up",
] as const;

export type CommunicationCategory = (typeof COMMUNICATION_CATEGORIES)[number];

const TAG_ALIASES: Record<string, string> = {
  name: "customer_first_name",
  firstName: "customer_first_name",
  customer_first_name: "customer_first_name",
  address: "property_address",
  property_address: "property_address",
  service_name: "service_name",
  company_name: "company_name",
  companyName: "company_name",
};

export function renderMergeTags(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const name = TAG_ALIASES[key];
    if (!name) return match;
    return values[name] ?? "";
  });
}

export interface AudienceFilter {
  customerIds?: number[];
  tag?: string;
  serviceId?: number;
  crewId?: number;
  routeId?: number;
  scheduledFrom?: string;
  scheduledTo?: string;
}

export class TemplateInputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TemplateInputError(`Choose a valid ${label}.`);
  return id;
}

export function normalizeAudience(input: unknown): AudienceFilter {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new TemplateInputError("Audience filter must be an object.");
  const value = input as Record<string, unknown>;
  const filter: AudienceFilter = {};
  if (value.customerIds != null) {
    if (!Array.isArray(value.customerIds) || value.customerIds.length > 500) throw new TemplateInputError("Choose up to 500 customers.");
    filter.customerIds = [...new Set(value.customerIds.map(id => positiveId(id, "customer")))];
  }
  if (typeof value.tag === "string" && value.tag.trim()) {
    if (value.tag.trim().length > 80) throw new TemplateInputError("Tag is too long.");
    filter.tag = value.tag.trim();
  }
  if (value.serviceId != null && value.serviceId !== "") filter.serviceId = positiveId(value.serviceId, "service");
  if (value.crewId != null && value.crewId !== "") filter.crewId = positiveId(value.crewId, "crew");
  if (value.routeId != null && value.routeId !== "") filter.routeId = positiveId(value.routeId, "route");
  for (const field of ["scheduledFrom", "scheduledTo"] as const) {
    if (value[field] == null || value[field] === "") continue;
    if (typeof value[field] !== "string" || !DATE.test(value[field])) throw new TemplateInputError("Schedule dates must be YYYY-MM-DD.");
    filter[field] = value[field];
  }
  if (filter.scheduledFrom && filter.scheduledTo && filter.scheduledFrom > filter.scheduledTo) {
    throw new TemplateInputError("The schedule end must be on or after the start.");
  }
  return filter;
}

export type FormFieldType = "text" | "textarea" | "email" | "phone" | "number" | "date" | "select" | "checkbox" | "file";

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  /** Shown only when the visitor selects this catalog service. */
  serviceId: number | null;
  condition: { field: string; equals: string } | null;
}

const FIELD_TYPES = new Set<FormFieldType>(["text", "textarea", "email", "phone", "number", "date", "select", "checkbox", "file"]);
const FIELD_ID = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export function normalizeFormFields(input: unknown): FormField[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 80) throw new TemplateInputError("Add between 1 and 80 form fields.");
  const ids = new Set<string>();
  return input.map(raw => {
    if (!raw || typeof raw !== "object") throw new TemplateInputError("Each field needs a label and type.");
    const row = raw as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!FIELD_ID.test(id) || ids.has(id) || id === "service_id") throw new TemplateInputError("Field ids must be unique and start with a letter.");
    ids.add(id);
    const type = row.type as FormFieldType;
    if (!FIELD_TYPES.has(type)) throw new TemplateInputError("Choose a supported field type.");
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label || label.length > 200) throw new TemplateInputError("Each field needs a label.");
    const options = Array.isArray(row.options) ? row.options.map(option => String(option).trim()).filter(Boolean).slice(0, 40) : [];
    if (type === "select" && options.length === 0) throw new TemplateInputError(`${label} needs at least one choice.`);
    let condition: FormField["condition"] = null;
    if (row.condition != null) {
      const source = row.condition as Record<string, unknown>;
      if (!source || typeof source.field !== "string" || !FIELD_ID.test(source.field) || typeof source.equals !== "string") {
        throw new TemplateInputError("Field conditions need an earlier field and a matching value.");
      }
      condition = { field: source.field, equals: source.equals };
    }
    return {
      id,
      label,
      type,
      required: row.required === true,
      options,
      serviceId: row.serviceId == null || row.serviceId === "" ? null : positiveId(row.serviceId, "service"),
      condition,
    };
  });
}

export function visibleFormFields(fields: FormField[], answers: Record<string, unknown>, lockedServiceId?: number | null): FormField[] {
  const chosen = lockedServiceId ?? (answers.service_id == null || answers.service_id === "" ? null : Number(answers.service_id));
  return fields.filter(field => {
    if (field.serviceId != null && field.serviceId !== chosen) return false;
    if (field.condition && String(answers[field.condition.field] ?? "") !== field.condition.equals) return false;
    return true;
  });
}

export function validateFormAnswers(fields: FormField[], answers: Record<string, unknown>, lockedServiceId?: number | null): string | null {
  const visible = visibleFormFields(fields, answers, lockedServiceId);
  const hidden = new Set(fields.filter(field => !visible.includes(field)).map(field => field.id));
  if ([...hidden].some(id => answers[id] != null && answers[id] !== "")) return "A hidden question was answered. Reload the form and submit only the questions you can see.";
  for (const field of visible) {
    const value = answers[field.id];
    const empty = value == null || value === "" || value === false && field.type === "checkbox";
    if (field.required && empty) return `${field.label} is required.`;
    if (field.type === "select" && value != null && value !== "" && !field.options.includes(String(value))) return `${field.label} has an unknown choice.`;
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return "Enter a valid email.";
  }
  return null;
}
