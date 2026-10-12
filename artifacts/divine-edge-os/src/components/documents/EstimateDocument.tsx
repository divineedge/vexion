import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, Phone, Mail, Globe } from 'lucide-react';
import { billableItems } from '@/lib/estimateSelection';

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-700 border-gray-200',
  sent:     'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
  expired:  'bg-amber-100 text-amber-700 border-amber-200',
};

interface LineItem {
  id: string; description: string; qty: number; unitPrice: number; markup: number; discount: number;
  isOptional: boolean; optionalPitchLine: string; category?: 'labor' | 'parts' | 'other';
}
const calcItem = (i: LineItem) => i.qty * i.unitPrice * (1 + i.markup / 100) * (1 - i.discount / 100);
const getItemCategory = (i: LineItem) => i.category ?? 'labor';
const CATEGORY_LABELS: Record<'labor' | 'parts' | 'other', string> = { labor: 'Labor', parts: 'Parts / Materials', other: 'Other' };

/** Resolve customer-facing terms: snapshot termsText, falling back to the legacy JSONB text_block. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function estimateTerms(estimate: any): string {
  if (typeof estimate?.termsText === 'string') return estimate.termsText;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = ((estimate?.lineItems ?? []) as any[]).find(i => i?.type === 'text_block' && i?.role === 'terms');
  return legacy?.content ?? '';
}

/** Shared customer-facing notes block (staff preview, print preview parity, public page). */
export function EstimateNotesBlock({ notes }: { notes?: string | null }) {
  if (!notes?.trim()) return null;
  return (
    <div className="bg-card rounded-xl border p-4" data-testid="estimate-notes-block">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Notes from us</p>
      <p className="text-sm whitespace-pre-wrap">{notes}</p>
    </div>
  );
}

/** Shared customer-facing terms block. */
export function EstimateTermsBlock({ terms }: { terms?: string | null }) {
  if (!terms?.trim()) return null;
  return (
    <div className="bg-card rounded-xl border p-4" data-testid="estimate-terms-block">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Terms &amp; Conditions</p>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{terms}</p>
    </div>
  );
}

/**
 * Shared read-only estimate renderer used by the staff estimate preview and by
 * the estimate-template editor preview. Does not include approval actions.
 */
export function EstimateDocument({ estimate, settings, preview = true }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  preview?: boolean;
}) {
  const [showPreviewBreakdown, setShowPreviewBreakdown] = useState(false);
  const items = (estimate?.lineItems ?? []) as LineItem[];
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);
  const total = billableItems(items).reduce((s, i) => s + calcItem(i), 0);

  // Build category groups for preview breakdown
  const previewCatGroups = (['labor', 'parts', 'other'] as const)
    .map(key => ({ key, label: CATEGORY_LABELS[key], items: required.filter(i => getItemCategory(i) === key) }))
    .filter(g => g.items.length > 0);
  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    return base.endsWith('/') ? base.slice(0, -1) : base;
  })();


  if (!estimate) return null;
  const isSample = estimate.id === 'PREVIEW';

  return (
          <div className="max-w-2xl mx-auto p-6 space-y-5 bg-muted/30">
            {/* Branding header */}
            <div className="text-center space-y-2">
              <img
                src={`${apiBase}/api/public/tenants/${estimate.tenantId ?? settings?.tenantId}/logo`}
                alt="Company logo"
                className="h-14 w-auto mx-auto object-contain"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {settings?.companyName && <h1 className="text-xl font-bold">{settings.companyName}</h1>}
              {settings?.businessTagline && <p className="text-xs text-muted-foreground italic">{settings.businessTagline}</p>}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {settings?.businessPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{settings.businessPhone}</span>}
                {settings?.businessEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{settings.businessEmail}</span>}
                {settings?.businessWebsite && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{settings.businessWebsite}</span>}
              </div>
            </div>

            {/* Estimate header */}
            <div className="bg-card rounded-xl border p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">{isSample ? 'Estimate (preview)' : `Estimate #${estimate.id}`}</h2>
                  <p className="text-sm text-muted-foreground" title={estimate.createdAt ? `Prepared on ${format(new Date(estimate.createdAt), 'EEEE, MMMM d, yyyy')}` : undefined}>Prepared {estimate.createdAt ? format(new Date(estimate.createdAt), 'MMMM d, yyyy') : ''}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[estimate.status] ?? ''}`}>{estimate.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {estimate.customerName && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Customer</p>{(estimate as any).customerId ? <a href={`${import.meta.env.BASE_URL}customers/${(estimate as any).customerId}`} className="font-medium text-primary hover:underline">{estimate.customerName}</a> : <p className="font-medium">{estimate.customerName}</p>}</div>
                )}
                {estimate.propertyAddress && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Property</p>{(estimate as any).propertyId ? <a href={`${import.meta.env.BASE_URL}properties/${(estimate as any).propertyId}`} className="font-medium text-primary hover:underline">{estimate.propertyAddress}</a> : <p>{estimate.propertyAddress}</p>}</div>
                )}
                {estimate.scheduledAt && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Scheduled</p><p>{format(new Date(estimate.scheduledAt), 'MMM d, yyyy h:mm a')}</p></div>
                )}
                {estimate.expiresAt && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Expires</p><p>{format(new Date(estimate.expiresAt), 'MMM d, yyyy')}</p></div>
                )}
              </div>
            </div>

            {/* Line items */}
            <div className="bg-card rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Services</h3>
                <button
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => setShowPreviewBreakdown(v => !v)}
                  title={showPreviewBreakdown ? 'Collapse to total only' : 'Expand to see cost breakdown by category'}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPreviewBreakdown ? 'rotate-180' : ''}`} />
                  {showPreviewBreakdown ? 'Hide breakdown' : 'View breakdown'}
                </button>
              </div>

              {showPreviewBreakdown ? (
                <div className="space-y-3">
                  {previewCatGroups.map(cat => {
                    const catTotal = cat.items.reduce((s, i) => s + calcItem(i), 0);
                    return (
                      <div key={cat.key}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                          <span className="text-xs font-semibold text-muted-foreground">${catTotal.toFixed(2)}</span>
                        </div>
                        <div className="pl-3 border-l-2 border-muted space-y-2">
                          {cat.items.map(item => (
                            <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                              <div className="flex-1">
                                <p className="font-medium">{item.description || '—'}</p>
                                {(item.markup > 0 || item.discount > 0) && (
                                  <p className="text-xs text-muted-foreground">
                                    ${item.unitPrice.toFixed(2)} each{item.markup > 0 && ` + ${item.markup}% markup`}{item.discount > 0 && ` − ${item.discount}% off`}
                                  </p>
                                )}
                              </div>
                              <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {optional.length > 0 && (
                    <div className="pt-1">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Optional Add-Ons</p>
                      <div className="space-y-1">
                        {optional.map(item => (
                          <div key={item.id} className="flex items-start justify-between gap-4 text-sm bg-amber-50/40 rounded p-2">
                            <div className="flex-1">
                              <p className="font-medium">{item.description || '—'}</p>
                              {item.optionalPitchLine && <p className="text-xs text-muted-foreground italic">{item.optionalPitchLine}</p>}
                            </div>
                            <span className="font-medium shrink-0">${calcItem(item).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between items-center font-bold">
                    <span>Total</span>
                    <span className="text-lg">${total.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="border-t pt-3 flex justify-between items-center font-bold">
                  <span>Total</span>
                  <span className="text-lg">${total.toFixed(2)}</span>
                </div>
              )}
            </div>
            <EstimateNotesBlock notes={estimate.notes} />
            <EstimateTermsBlock terms={estimateTerms(estimate)} />
            {preview && (
              <p className="text-center text-xs text-muted-foreground border border-dashed rounded-md py-2">
                The customer approves or declines here once the estimate is sent.
              </p>
            )}
          </div>
  );
}
