export class BudgetDocumentError extends Error {}

export type StoredDivision = Record<string, unknown> & { id: string; name: string; serviceIds: number[] };
export type StoredBudgetYear = Record<string, unknown> & { year: number; divisions: StoredDivision[]; overheadOverrides: Record<string, unknown> };

function finite(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function serviceIds(value: unknown, strict: boolean): number[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new BudgetDocumentError("Division serviceIds must be an array");
    return [];
  }
  const ids: number[] = [];
  for (const id of value) {
    const number = typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id.trim()) ? Number(id) : NaN;
    if (!Number.isSafeInteger(number) || number <= 0) {
      if (strict) throw new BudgetDocumentError("Invalid service ID in budget");
      continue;
    }
    ids.push(number);
  }
  return ids;
}

function asDivision(raw: unknown, fallbackName: string, index: number, strict: boolean): StoredDivision | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallbackName;
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : `legacy-${index + 1}`;
  if (!name) return null;
  return {
    ...source,
    id,
    name,
    serviceIds: serviceIds(source.serviceIds, strict),
    customOverhead: Array.isArray(source.customOverhead) ? source.customOverhead : [],
    crewCount: finite(source.crewCount, 1),
    workWeeksPerYear: finite(source.workWeeksPerYear, 32),
    workDaysPerWeek: finite(source.workDaysPerWeek, 5),
    billableHoursPerDay: finite(source.billableHoursPerDay, 8),
    employeesPerCrew: finite(source.employeesPerCrew, 1),
  };
}

export function parseBudgetDocument(raw: unknown): unknown[] {
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null") return [];
    try { value = JSON.parse(trimmed); } catch { throw new BudgetDocumentError("Stored budget data is not valid JSON"); }
  }
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return [value];
  return [];
}

function looksLikeFlatDivision(source: Record<string, unknown>): boolean {
  return !Array.isArray(source.divisions) && (source.crewCount != null || source.workWeeksPerYear != null || typeof source.name === "string");
}

export function normalizeBudgetYear(raw: unknown, fallbackYear: number): StoredBudgetYear | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const yearNumber = Number(source.year);
  const year = Number.isInteger(yearNumber) ? yearNumber : fallbackYear;
  const divisionRows = Array.isArray(source.divisions)
    ? source.divisions
    : looksLikeFlatDivision(source)
      ? [source]
      : [];
  const divisions = divisionRows
    .map((item, index) => asDivision(item, `Division ${index + 1}`, index, false))
    .filter((item): item is StoredDivision => item != null);
  const seen = new Set<number>();
  for (const division of divisions) {
    division.serviceIds = division.serviceIds.filter(id => seen.has(id) ? false : (seen.add(id), true));
  }
  return {
    ...source,
    year,
    divisions,
    overheadOverrides: source.overheadOverrides && typeof source.overheadOverrides === "object" && !Array.isArray(source.overheadOverrides)
      ? source.overheadOverrides as Record<string, unknown>
      : {},
    annualWorkingWeeks: finite(source.annualWorkingWeeks, 48) > 0 ? finite(source.annualWorkingWeeks, 48) : 48,
    companyFloorPriceOverride: typeof source.companyFloorPriceOverride === "number" && Number.isFinite(source.companyFloorPriceOverride) ? source.companyFloorPriceOverride : null,
  };
}

export function appendBudgetDivision(raw: unknown, year: number, division: unknown): { years: StoredBudgetYear[]; division: StoredDivision } {
  if (!Number.isInteger(year)) throw new BudgetDocumentError("A budget year is required");
  const next = asDivision(division, "", 0, true);
  if (!next) throw new BudgetDocumentError("A division name is required");
  const years = parseBudgetDocument(raw)
    .map(item => normalizeBudgetYear(item, year))
    .filter((item): item is StoredBudgetYear => item != null);
  let target = years.find(item => item.year === year);
  if (!target) {
    target = {
      year,
      divisions: [],
      overheadOverrides: {},
      annualWorkingWeeks: 48,
      companyFloorPriceOverride: null,
      companyMidYearCheckup: {},
      companyEndYearCheckup: {},
    };
    years.push(target);
  }
  const existing = target.divisions.findIndex(item => item.id === next.id);
  const taken = new Set(target.divisions.filter(item => item.id !== next.id).flatMap(item => item.serviceIds));
  next.serviceIds = next.serviceIds.filter(id => !taken.has(id));
  if (existing >= 0) target.divisions[existing] = next;
  else target.divisions.push(next);
  return { years, division: next };
}
