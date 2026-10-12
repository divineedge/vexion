import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Phone, Mail, Globe, Building2, Download, FileText, AlertCircle, ScrollText } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';

export interface InvoiceBusinessProfile {
  companyName?: string | null;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  invoiceFooterText?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid:      'bg-emerald-100 text-emerald-800 border-transparent',
  sent:      'bg-blue-100 text-blue-800 border-transparent',
  overdue:   'bg-red-100 text-red-800 border-transparent',
  draft:     'bg-gray-100 text-gray-800 border-transparent',
  cancelled: 'bg-slate-100 text-slate-600 border-transparent',
};

interface InvoiceLineItem {
  id: number | string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ── Layout: Clean ─────────────────────────────────────────────────────────────
// Minimal totals; descriptions only, no per-item quantity breakdown.
function CleanLineItems({ items, subtotal, tax, total }: {
  items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Services</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items.</p>
        ) : items.map((item, idx) => (
          <div key={item.id ?? idx} className="flex items-center justify-between gap-4">
            <p className="text-sm">{item.description}</p>
            <span className="font-medium text-sm shrink-0">
              ${(item.total ?? item.quantity * item.unitPrice).toFixed(2)}
            </span>
          </div>
        ))}
        <Separator />
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Tax</span><span>${tax.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center font-bold pt-1">
            <span className="text-base">Total</span>
            <span className="text-2xl">${total.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Layout: Detailed ──────────────────────────────────────────────────────────
// Full quantity × unit price breakdown per line item.
function DetailedLineItems({ items, subtotal, tax, total }: {
  items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Services</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items.</p>
        ) : items.map((item, idx) => (
          <div key={item.id ?? idx} className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="font-medium text-sm">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                Qty {item.quantity} × ${(item.unitPrice ?? 0).toFixed(2)}
              </p>
            </div>
            <span className="font-semibold text-sm shrink-0">
              ${(item.total ?? item.quantity * item.unitPrice).toFixed(2)}
            </span>
          </div>
        ))}
        <Separator />
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Tax</span><span>${tax.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center font-bold pt-1">
            <span className="text-base">Total</span>
            <span className="text-2xl">${total.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Layout: Compact ───────────────────────────────────────────────────────────
// Single column; dense spacing. Good for short invoices on mobile.
function CompactLineItems({ items, subtotal, tax, total }: {
  items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  return (
    <div className="rounded-lg border divide-y text-sm">
      {items.map((item, idx) => (
        <div key={item.id ?? idx} className="flex justify-between px-4 py-2 gap-3">
          <span className="text-muted-foreground">{item.description}</span>
          <span className="font-medium shrink-0">
            ${(item.total ?? item.quantity * item.unitPrice).toFixed(2)}
          </span>
        </div>
      ))}
      <div className="flex justify-between px-4 py-2 text-muted-foreground">
        <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
      </div>
      {tax > 0 && (
        <div className="flex justify-between px-4 py-2 text-muted-foreground">
          <span>Tax</span><span>${tax.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between px-4 py-3 font-bold">
        <span>Total</span>
        <span className="text-xl">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}


/**
 * Shared customer-facing invoice renderer. Used by the public invoice page and
 * by the staff read-only preview so both show exactly the same document.
 * Template fields (layout, termsText, late fees) come from the invoice's own
 * snapshot, so editing a template never changes an existing invoice.
 */
export function InvoiceDocument({ invoice, businessProfile, preview = false }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any;
  businessProfile?: InvoiceBusinessProfile | null;
  preview?: boolean;
}) {
  const inv = invoice as any;
  const biz = businessProfile ?? inv.businessProfile;
  const lineItems = (inv.lineItems ?? []) as InvoiceLineItem[];
  const subtotal: number = inv.subtotal ?? 0;
  const tax: number = inv.tax ?? 0;
  const total: number = inv.total ?? 0;
  const layout: string = inv.layout ?? 'detailed';

  // Derive base URL for the public logo endpoint
  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const clean = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${clean}/api`;
  })();
  const logoUrl = `${apiBase}/public/tenants/${inv.tenantId}/logo`;

  // Late-fee calculation
  const isOverdue = inv.status === 'overdue' || (
    inv.status === 'sent' && inv.dueDate && new Date(inv.dueDate) < new Date()
  );
  const daysPastDue = inv.dueDate
    ? differenceInDays(new Date(), parseISO(inv.dueDate))
    : 0;

  // Multi-rule schedule (new) vs. legacy single-fee (old)
  const lateFeeSchedule: Array<{
    id: string; daysAfterDue: number; type: 'flat' | 'percent'; amount: number; repeatEveryDays?: number;
  }> = ((inv as any).lateFeeSchedule ?? []) as any;

  interface AppliedFee { label: string; feeAmount: number; }
  const appliedFees: AppliedFee[] = [];

  if (isOverdue && lateFeeSchedule.length > 0) {
    const sorted = [...lateFeeSchedule].sort((a, b) => a.daysAfterDue - b.daysAfterDue);
    for (const rule of sorted) {
      if (daysPastDue < rule.daysAfterDue) continue;
      const base = inv.subtotal ?? inv.total ?? 0;
      const feeAmount = rule.type === 'flat' ? rule.amount : base * rule.amount / 100;
      const fmtAmt = rule.type === 'flat' ? `$${rule.amount.toFixed(2)}` : `${rule.amount}%`;
      if (rule.repeatEveryDays) {
        const occurrences = Math.max(1, Math.floor((daysPastDue - rule.daysAfterDue) / rule.repeatEveryDays) + 1);
        appliedFees.push({
          label: `${fmtAmt} ${rule.type === 'percent' ? 'of balance ' : ''}(repeating every ${rule.repeatEveryDays} days — applied ${occurrences}×)`,
          feeAmount: feeAmount * occurrences,
        });
      } else {
        appliedFees.push({
          label: `${fmtAmt} ${rule.type === 'percent' ? 'of balance ' : ''}after ${rule.daysAfterDue} days`,
          feeAmount,
        });
      }
    }
  }

  // Legacy single-fee fallback
  const legacyLateFee = inv.lateFeeEnabled && isOverdue && daysPastDue > (inv.lateFeeDaysGrace ?? 0) && lateFeeSchedule.length === 0;
  const showLateFeeNotice = appliedFees.length > 0 || legacyLateFee;
  const totalAppliedFees = appliedFees.reduce((s, f) => s + f.feeAmount, 0);

  // Job completion date
  const showCompletionDate = (inv as any).showJobCompletionDate && (inv as any).jobCompletedAt;


  return (
    <div className={preview ? "bg-muted/30 py-6 px-4" : "min-h-screen bg-muted/30 py-8 px-4 print:bg-white print:py-0 print:px-0"}>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Download / Print button */}
        {!preview && <div className="flex justify-end print:hidden">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>}

        {/* Late-fee notice banner */}
        {showLateFeeNotice && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 print:border-red-400">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-semibold text-red-800">This invoice is overdue</p>
              {appliedFees.length > 0 ? (
                <div className="mt-1.5 space-y-1">
                  {appliedFees.map((fee, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <span className="text-red-700">{fee.label}</span>
                      <span className="font-semibold text-red-800 shrink-0">${fee.feeAmount.toFixed(2)}</span>
                    </div>
                  ))}
                  {appliedFees.length > 1 && (
                    <div className="flex items-center justify-between gap-4 border-t border-red-200 pt-1 mt-1">
                      <span className="text-red-700 font-medium">Total additional fees</span>
                      <span className="font-bold text-red-800 shrink-0">${totalAppliedFees.toFixed(2)}</span>
                    </div>
                  )}
                  <p className="text-red-600 text-xs mt-1">Please remit payment as soon as possible to avoid additional charges.</p>
                </div>
              ) : (
                <p className="text-red-700 mt-0.5">
                  {inv.lateFeeType === 'percent'
                    ? `A ${inv.lateFeeAmount}% late fee`
                    : `A $${(inv.lateFeeAmount ?? 0).toFixed(2)} late fee`}{' '}
                  applies after {inv.lateFeeDaysGrace ?? 0} day{(inv.lateFeeDaysGrace ?? 0) !== 1 ? 's' : ''} past the due date.
                  Please remit payment as soon as possible.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Job completion date banner */}
        {showCompletionDate && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <span className="text-xs font-medium text-blue-700 uppercase tracking-wide">Job completed</span>
            <span className="text-sm font-semibold text-blue-900">
              {format(parseISO((inv as any).jobCompletedAt), 'MMMM d, yyyy')}
            </span>
          </div>
        )}

        {/* Business branding header */}
        <div className="text-center space-y-3">
          <img
            src={logoUrl}
            alt="Company logo"
            className="h-16 w-auto mx-auto object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          {biz?.companyName && (
            <h1 className="text-2xl font-bold">{biz.companyName}</h1>
          )}
          {biz?.tagline && (
            <p className="text-sm text-muted-foreground italic">{biz.tagline}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {biz?.phone && (
              <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{biz.phone}</span>
            )}
            {biz?.email && (
              <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{biz.email}</span>
            )}
            {biz?.website && (
              <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{biz.website}</span>
            )}
            {biz?.address && (
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{biz.address}</span>
            )}
          </div>
          <Separator />
        </div>

        {/* Invoice identity */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-2xl font-bold font-mono">{inv.invoiceNumber}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Issued {format(new Date(inv.createdAt), 'MMMM d, yyyy')}
            </p>
            {inv.dueDate && (
              <p className="text-sm text-muted-foreground">
                Due {format(new Date(inv.dueDate), 'MMMM d, yyyy')}
              </p>
            )}
          </div>
          <Badge className={`text-sm px-3 py-1 ${STATUS_COLORS[inv.status] ?? ''}`} variant="outline">
            {(inv.status as string).toUpperCase()}
          </Badge>
        </div>

        {/* Customer */}
        {inv.customerName && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Bill To</p>
              <p className="font-semibold">{inv.customerName}</p>
            </CardContent>
          </Card>
        )}

        {/* Line Items — layout variants */}
        {layout === 'compact' ? (
          <CompactLineItems items={lineItems} subtotal={subtotal} tax={tax} total={total} />
        ) : layout === 'clean' ? (
          <CleanLineItems items={lineItems} subtotal={subtotal} tax={tax} total={total} />
        ) : (
          <DetailedLineItems items={lineItems} subtotal={subtotal} tax={tax} total={total} />
        )}

        {/* Notes */}
        {inv.notes && (
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm">{inv.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Terms & Conditions */}
        {inv.termsText && (
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Terms &amp; Conditions</p>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{inv.termsText}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer text */}
        {biz?.invoiceFooterText && (
          <p className="text-xs text-center text-muted-foreground pt-2 pb-4">{biz.invoiceFooterText}</p>
        )}

        {/* Stripe payment link */}
        {preview && inv.status !== 'paid' && (
          <p className="text-center text-xs text-muted-foreground border border-dashed rounded-md py-2 print:hidden">
            {inv.stripePaymentUrl ? `The customer sees a Pay Invoice button for $${total.toFixed(2)} here.` : 'A Pay Invoice button appears here once a payment link exists.'}
          </p>
        )}
        {!preview && inv.stripePaymentUrl && inv.status !== 'paid' && (
          <div className="flex justify-center print:hidden">
            <a href={inv.stripePaymentUrl} target="_blank" rel="noopener noreferrer">
              <Button size="lg" className="gap-2">
                Pay Invoice — ${total.toFixed(2)}
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function businessProfileFromSettings(s: any): InvoiceBusinessProfile {
  const addr = s?.businessContactAddress ?? [s?.businessAddress, s?.businessCity, s?.businessState, s?.businessZip].filter(Boolean).join(', ');
  return {
    companyName: s?.companyName ?? null,
    tagline: s?.businessTagline ?? null,
    phone: s?.businessPhone ?? null,
    email: s?.businessEmail ?? null,
    website: s?.businessWebsite ?? null,
    address: addr || null,
    invoiceFooterText: s?.invoiceFooterText ?? null,
  };
}
