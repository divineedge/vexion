/**
 * Builds in-memory invoice / estimate objects from unsaved form state so the
 * shared renderers (InvoiceDocument, buildInvoicePrintDocument,
 * buildEstimatePrintDocument) can preview exactly what will be produced.
 * Nothing here is saved or sent.
 */

export const SAMPLE_CUSTOMER = {
  name: 'Sample Customer (preview only)',
  address: '1200 Example Ave, Sample City',
};

export interface PreviewLine { description: string; quantity: number; unitPrice: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function settingsTaxRate(settings: any): number {
  if (!settings || settings.taxEnabled === false) return 0;
  const r = Number(settings.taxRate ?? 0);
  return Number.isFinite(r) ? r : 0;
}

/** Resolve wording: null/undefined inherits the default, '' explicitly suppresses. */
export function resolveWording(override: string | null | undefined, fallback: string | null | undefined): string {
  if (override === '' ) return '';
  if (override != null) return override;
  return fallback ?? '';
}

export function buildPreviewInvoice(opts: {
  lines: PreviewLine[];
  notes?: string | null;
  termsText?: string | null;
  layout?: string | null;
  lateFeeEnabled?: boolean;
  lateFeeType?: string | null;
  lateFeeAmount?: number | null;
  lateFeeDaysGrace?: number | null;
  customerName?: string | null;
  invoiceNumber?: string;
  dueDays?: number;
  taxRatePct?: number;
  tenantId?: number | null;
  status?: string;
}) {
  const lineItems = opts.lines
    .filter(l => (l.description ?? '').trim() !== '' || l.unitPrice)
    .map((l, i) => ({ id: i + 1, description: l.description || 'Untitled item', quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, total: (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) }));
  const subtotal = lineItems.reduce((s, l) => s + l.total, 0);
  const tax = Math.round(subtotal * ((opts.taxRatePct ?? 0) / 100) * 100) / 100;
  const now = new Date();
  const due = new Date(now.getTime() + (opts.dueDays ?? 30) * 86400000);
  return {
    id: 0,
    invoiceNumber: opts.invoiceNumber ?? 'INV-PREVIEW',
    status: opts.status ?? 'draft',
    customerName: opts.customerName || SAMPLE_CUSTOMER.name,
    createdAt: now.toISOString(),
    dueDate: due.toISOString(),
    lineItems,
    subtotal,
    tax,
    total: subtotal + tax,
    notes: opts.notes ?? '',
    termsText: opts.termsText ?? '',
    layout: opts.layout ?? 'clean',
    lateFeeEnabled: !!opts.lateFeeEnabled,
    lateFeeType: opts.lateFeeType ?? 'percent',
    lateFeeAmount: opts.lateFeeAmount ?? null,
    lateFeeDaysGrace: opts.lateFeeDaysGrace ?? 0,
    tenantId: opts.tenantId ?? null,
    stripePaymentUrl: null,
  };
}

export function buildPreviewEstimate(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lineItems: any[];
  notes?: string | null;
  termsText?: string | null;
  customerName?: string | null;
  propertyAddress?: string | null;
  expiryDays?: number;
  tenantId?: number | null;
  id?: number | string;
  status?: string;
}) {
  const now = new Date();
  return {
    id: opts.id ?? 'PREVIEW',
    status: opts.status ?? 'draft',
    customerName: opts.customerName || SAMPLE_CUSTOMER.name,
    propertyAddress: opts.propertyAddress ?? SAMPLE_CUSTOMER.address,
    createdAt: now.toISOString(),
    expiresAt: opts.expiryDays ? new Date(now.getTime() + opts.expiryDays * 86400000).toISOString() : null,
    lineItems: (opts.lineItems ?? []).map((l, i) => ({
      id: l.id ?? String(i + 1),
      description: l.description ?? '',
      qty: Number(l.qty ?? l.quantity ?? 1) || 0,
      unitPrice: Number(l.unitPrice ?? 0) || 0,
      markup: Number(l.markup ?? 0) || 0,
      discount: Number(l.discount ?? 0) || 0,
      isOptional: !!l.isOptional,
      optionalPitchLine: l.optionalPitchLine ?? '',
    })),
    notes: opts.notes ?? '',
    termsText: opts.termsText ?? '',
    tenantId: opts.tenantId ?? null,
  };
}

/** Normalize a WordingField value for saving: null inherits, whitespace-only becomes '' (suppress). */
export function normalizeWording(v: string | null): string | null {
  if (v === null) return null;
  return v.trim() === '' ? '' : v;
}
