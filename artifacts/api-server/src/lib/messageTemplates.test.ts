import { describe, expect, it } from "vitest";
import {
  renderMergeTags, visibleFormFields, validateFormAnswers, normalizeAudience, type FormField,
} from "./messageTemplates";

const fields: FormField[] = [
  { id: "name", label: "Name", type: "text", required: true, options: [], serviceId: null, condition: null },
  { id: "mowing_gate", label: "Gate code", type: "text", required: true, options: [], serviceId: 10, condition: null },
  { id: "irrigation_zone", label: "Broken zone", type: "text", required: true, options: [], serviceId: 20, condition: null },
  { id: "license", label: "Driver's license", type: "select", required: true, options: ["yes", "no"], serviceId: null, condition: { field: "role", equals: "driver" } },
];

describe("message and form templates", () => {
  it("fills merge tags and keeps the first-name alias", () => {
    const text = renderMergeTags("Hi {{customer_first_name}}, {{name}} at {{property_address}} for {{service_name}}.", {
      customer_first_name: "Ada",
      property_address: "1 Main",
      service_name: "Aeration",
      company_name: "Divine",
    });
    expect(text).toBe("Hi Ada, Ada at 1 Main for Aeration.");
  });

  it("shows only the selected service's questions", () => {
    const visible = visibleFormFields(fields, { service_id: 10 }).map(field => field.id);
    expect(visible).toEqual(["name", "mowing_gate"]);
    expect(validateFormAnswers(fields, { service_id: 10, name: "Ada", irrigation_zone: "3" })).toMatch(/hidden/);
    expect(validateFormAnswers(fields, { service_id: 10, name: "Ada", mowing_gate: "1234" })).toBeNull();
  });

  it("hides a hiring question until its condition matches", () => {
    expect(visibleFormFields(fields, { role: "tech" }).map(field => field.id)).not.toContain("license");
    expect(visibleFormFields(fields, { role: "driver" }).map(field => field.id)).toContain("license");
  });

  it("accepts a date-range audience and rejects a backwards range", () => {
    expect(normalizeAudience({ scheduledFrom: "2026-04-01", scheduledTo: "2026-04-03", crewId: 4 }).crewId).toBe(4);
    expect(() => normalizeAudience({ scheduledFrom: "2026-05-02", scheduledTo: "2026-04-01" })).toThrow(/end/);
  });
});
