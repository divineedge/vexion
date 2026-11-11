export interface TemplateField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'checkbox' | 'file';
  required: boolean;
  options: string[];
  serviceId: number | null;
  condition: { field: string; equals: string } | null;
}

export function visibleTemplateFields(fields: TemplateField[], answers: Record<string, unknown>, lockedServiceId?: number | null) {
  const chosen = lockedServiceId ?? (answers.service_id == null || answers.service_id === '' ? null : Number(answers.service_id));
  return fields.filter(field => {
    if (field.serviceId != null && field.serviceId !== chosen) return false;
    if (field.condition && String(answers[field.condition.field] ?? '') !== field.condition.equals) return false;
    return true;
  });
}

export const QUOTE_FIELDS: TemplateField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true, options: [], serviceId: null, condition: null },
  { id: 'email', label: 'Email', type: 'email', required: true, options: [], serviceId: null, condition: null },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, options: [], serviceId: null, condition: null },
  { id: 'address', label: 'Property address', type: 'text', required: true, options: [], serviceId: null, condition: null },
];

export const HIRING_FIELDS: TemplateField[] = [
  { id: 'full_name', label: 'Full name', type: 'text', required: true, options: [], serviceId: null, condition: null },
  { id: 'email', label: 'Email', type: 'email', required: true, options: [], serviceId: null, condition: null },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, options: [], serviceId: null, condition: null },
  { id: 'years_experience', label: 'Years of experience', type: 'number', required: true, options: [], serviceId: null, condition: null },
  { id: 'drivers_license', label: "Driver's license status", type: 'select', required: true, options: ['Valid', 'Permit', 'None'], serviceId: null, condition: null },
  { id: 'available_start', label: 'Available start date', type: 'date', required: true, options: [], serviceId: null, condition: null },
  { id: 'resume', label: 'Resume', type: 'file', required: false, options: [], serviceId: null, condition: null },
  { id: 'certifications', label: 'Equipment certifications', type: 'textarea', required: false, options: [], serviceId: null, condition: null },
  { id: 'consent', label: 'I agree to store this application for hiring contact', type: 'checkbox', required: true, options: [], serviceId: null, condition: null },
];
