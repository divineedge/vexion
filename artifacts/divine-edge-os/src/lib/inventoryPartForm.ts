/** A type such as Pipe or PVC Pipe is sold by the foot. */
export function isPipeTypeName(name: string | null | undefined): boolean {
  return /\bpipe\b/i.test(name ?? "");
}

/** Existing category strings, drafts typed on this form, and the current value. */
export function categoryChoices(
  stored: readonly string[],
  drafts: readonly string[],
  current: string,
): string[] {
  const seen = new Map<string, string>();
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  };
  for (const value of stored) {
    for (const part of value.split(",")) add(part);
  }
  for (const draft of drafts) add(draft);
  add(current);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function namedId(items: readonly { id: number; name: string }[], name: string): number | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return items.find(item => item.name.trim().toLowerCase() === key)?.id ?? null;
}

export function feetFromLength(length: number): number {
  if (!Number.isFinite(length) || length < 0) return 0;
  return Math.max(0, Math.round(length));
}
