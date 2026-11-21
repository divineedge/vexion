export type FilterableOption = {
  label: string;
  detail?: string | null;
};

/** Case-insensitive substring match against the option label and its detail line. An empty query matches everything. */
export function optionMatchesFilter(option: FilterableOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (option.label.toLowerCase().includes(needle)) return true;
  return (option.detail ?? "").toLowerCase().includes(needle);
}

export function filterCreatableOptions<T extends FilterableOption>(options: readonly T[], query: string): T[] {
  if (!query.trim()) return [...options];
  return options.filter(option => optionMatchesFilter(option, query));
}
