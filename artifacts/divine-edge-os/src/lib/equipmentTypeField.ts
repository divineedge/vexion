/** Sentinel for "type a label that is not in the saved list". Never a stored type. */
export const CUSTOM_EQUIPMENT_TYPE = "__custom_equipment_type__";

export function equipmentTypeFieldState(args: {
  type: string;
  labels: readonly string[];
  customMode: boolean;
  typesLoaded: boolean;
}): { pickerValue: string | null; showCustomInput: boolean } {
  const listed = args.type !== "" && args.labels.includes(args.type);
  const showCustomInput =
    args.customMode || (args.typesLoaded && args.type !== "" && !listed);
  if (showCustomInput)
    return { pickerValue: CUSTOM_EQUIPMENT_TYPE, showCustomInput: true };
  if (listed) return { pickerValue: args.type, showCustomInput: false };
  return { pickerValue: null, showCustomInput: false };
}

/** Apply a picker choice. A listed label replaces the type; custom keeps a non-listed value. */
export function equipmentTypeAfterPick(
  picked: string,
  currentType: string,
  labels: readonly string[],
): { type: string; customMode: boolean } {
  if (picked === CUSTOM_EQUIPMENT_TYPE) {
    return {
      type: labels.includes(currentType) ? "" : currentType,
      customMode: true,
    };
  }
  return { type: picked, customMode: false };
}
