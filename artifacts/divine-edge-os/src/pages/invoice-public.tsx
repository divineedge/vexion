import React from 'react';
import { useParams } from 'wouter';
import { useGetPublicInvoice } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { XCircle, Phone, Mail, Globe, Building2, Download, FileText, AlertCircle, ScrollText } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';

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

export default function InvoicePublicPage() {
  const { token } = useParams<{ token: string }>();

  const { data: invoice, isLoading, error } = useGetPublicInvoice(token!, {
    query: { enabled: !!token, queryKey: ['getPublicInvoice', token] },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading invoice…</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Invoice Not Found</h2>
            <p className="text-muted-foreground">This invoice link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inv = invoice as any;
  const biz = inv.businessProfile;
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

  // Late-fee notice: show when overdue and lateFeeEnabled
  const isOverdue = inv.status === 'overdue' || (
    inv.status === 'sent' && inv.dueDate && new Date(inv.dueDate) < new Date()
  );
  const lateFeeDaysGrace: number = inv.lateFeeDaysGrace ?? 0;
  const daysPastDue = inv.dueDate
    ? differenceInDays(new Date(), parseISO(inv.dueDate))
    : 0;
  const showLateFeeNotice = inv.lateFeeEnabled && isOverdue && daysPastDue > lateFeeDaysGrace;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4 print:bg-white print:py-0 print:px-0">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Download / Print button */}
        <div className="flex justify-end print:hidden">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>

        {/* Late-fee notice banner */}
        {showLateFeeNotice && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 print:border-red-400">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-800">This invoice is overdue</p>
              <p className="text-red-700 mt-0.5">
                {inv.lateFeeType === 'percent'
                  ? `A ${inv.lateFeeAmount}% late fee`
                  : `A $${(inv.lateFeeAmount ?? 0).toFixed(2)} late fee`}{' '}
                applies after {lateFeeDaysGrace} day{lateFeeDaysGrace !== 1 ? 's' : ''} past the due date.
                Please remit payment as soon as possible.
              </p>
            </div>
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
        {inv.stripePaymentUrl && inv.status !== 'paid' && (
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
