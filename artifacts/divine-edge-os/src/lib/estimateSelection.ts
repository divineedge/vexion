/** Required scope plus explicitly chosen optional scope; one choice per group. */
export function billableItems<T extends { isOptional?: boolean; acceptedByCustomer?: boolean; groupId?: string | null }>(items: T[]): T[] {
  const groups = new Set<string>();
  return items.filter(item => {
    if (!item.isOptional) return true;
    if (!item.acceptedByCustomer) return false;
    if (!item.groupId) return true;
    if (groups.has(item.groupId)) return false;
    groups.add(item.groupId);
    return true;
  });
}
export function toggleOptionalSelection(id: string, selected: Set<string>, items: { id: string; groupId?: string | null }[]): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) { next.delete(id); return next; }
  const group = items.find(i => i.id === id)?.groupId;
  if (group) for (const item of items) if (item.groupId === group) next.delete(item.id);
  next.add(id);
  return next;
}
