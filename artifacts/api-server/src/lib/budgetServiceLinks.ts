export function budgetServiceLinks(payload: unknown): number[] {
  const years = Array.isArray(payload) ? payload : [payload];
  const allIds = new Set<number>();
  const yearAssignments = new Map<number, Set<number>>();
  for (const raw of years) {
    if (!raw || typeof raw !== 'object') throw new Error('Each budget must be an object');
    const year = raw as { year?: unknown; divisions?: unknown; serviceIds?: unknown };
    const yearKey = Number(year.year) || new Date().getFullYear();
    const assigned = yearAssignments.get(yearKey) ?? new Set<number>();
    yearAssignments.set(yearKey, assigned);
    const divisions = Array.isArray(year.divisions) ? year.divisions : [year];
    for (const rawDivision of divisions) {
      if (!rawDivision || typeof rawDivision !== 'object') throw new Error('Each division must be an object');
      const ids = (rawDivision as { serviceIds?: unknown }).serviceIds;
      if (ids === undefined) continue; // Existing budgets need no migration.
      if (!Array.isArray(ids)) throw new Error('Division serviceIds must be an array');
      for (const id of ids) {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid service ID in budget');
        if (assigned.has(id)) throw new Error(`Service ${id} can belong to only one division per budget year`);
        assigned.add(id);
        allIds.add(id);
      }
    }
  }
  return [...allIds];
}
