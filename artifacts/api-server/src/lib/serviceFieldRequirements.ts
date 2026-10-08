export type ServiceFieldRequirements = {
  invoiceDateBasis: "completed" | "scheduled";
  requiresChemicalApplication: boolean;
  showMaterialsOrParts: boolean;
};

/** Unknown/future JSON keys are ignored and legacy rows safely default to false. */
export function normalizeFieldRequirements(value: unknown): ServiceFieldRequirements {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    invoiceDateBasis: source.invoiceDateBasis === "scheduled" ? "scheduled" : "completed",
    requiresChemicalApplication: source.requiresChemicalApplication === true,
    showMaterialsOrParts: source.showMaterialsOrParts === true,
  };
}

export function chemicalCompletionError(requirements: unknown, hasApplication: boolean): string | null {
  return normalizeFieldRequirements(requirements).requiresChemicalApplication && !hasApplication
    ? "A chemical application must be logged before this job can be completed."
    : null;
}