export type InvoiceGrouping = "combined" | "by_property";
export type PropertyInvoiceLine = {
  description: string; quantity: number; unitPrice: number; total: number;
  propertyId?: number | null; propertyAddress?: string | null; jobId?: number | null;
  [key: string]: unknown;
};

export function customerInvoiceGrouping(policy: unknown): InvoiceGrouping {
  return (policy as { invoiceGrouping?: string } | null)?.invoiceGrouping === "by_property" ? "by_property" : "combined";
}

export function propertyInvoiceGroups<T extends { propertyId?: number | null }>(items: T[], mode: InvoiceGrouping): T[][] {
  if (mode === "combined") return items.length ? [items] : [];
  const groups = new Map<number | null, T[]>();
  for (const item of items) {
    const key = item.propertyId ?? null;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

export function labelPropertyLine<T extends { description: string; propertyId?: number | null }>(item: T, address?: string | null) {
  return { ...item, propertyAddress: address ?? null,
    description: address && !item.description.startsWith(`${address} — `) ? `${address} — ${item.description}` : item.description };
}
