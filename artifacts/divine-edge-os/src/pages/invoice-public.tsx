import React from 'react';
import { useParams } from 'wouter';
import { useGetPublicInvoice } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { XCircle, Phone, Mail, Globe, Building2, Download, FileText } from 'lucide-react';
import { format } from 'date-fns';

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

export default function InvoicePublicPage() {
  const { token } = useParams<{ token: string }>();

  const { data: invoice, isLoading, error } = useGetPublicInvoice(token!, {
    query: { enabled: !!token, queryKey: ['getPublicInvoice', token] },
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading invoice...</p>
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

  // Derive base URL for the public logo endpoint
  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const clean = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${clean}/api`;
  })();
  const logoUrl = `${apiBase}/public/tenants/${(invoice as any).tenantId}/logo`;
  const biz = (invoice as any).businessProfile;
  const lineItems = ((invoice as any).lineItems ?? []) as InvoiceLineItem[];

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4 print:bg-white print:py-0 print:px-0">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Download / Print button — hidden when printing */}
        <div className="flex justify-end print:hidden">
          <Button variant="outline" size="sm" className="gap-2" onClick={handlePrint}>
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>

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
              <h2 className="text-2xl font-bold font-mono">{(invoice as any).invoiceNumber}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Issued {format(new Date((invoice as any).createdAt), 'MMMM d, yyyy')}
            </p>
            {(invoice as any).dueDate && (
              <p className="text-sm text-muted-foreground">
                Due {format(new Date((invoice as any).dueDate), 'MMMM d, yyyy')}
              </p>
            )}
          </div>
          <Badge className={`text-sm px-3 py-1 ${STATUS_COLORS[(invoice as any).status] ?? ''}`} variant="outline">
            {((invoice as any).status as string).toUpperCase()}
          </Badge>
        </div>

        {/* Customer */}
        {(invoice as any).customerName && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Bill To</p>
              <p className="font-semibold">{(invoice as any).customerName}</p>
            </CardContent>
          </Card>
        )}

        {/* Line Items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items.</p>
            ) : (
              lineItems.map((item, idx) => (
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
              ))
            )}

            <Separator />

            {/* Totals */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>${((invoice as any).subtotal ?? 0).toFixed(2)}</span>
              </div>
              {((invoice as any).tax ?? 0) > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Tax</span>
                  <span>${((invoice as any).tax).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center font-bold pt-1">
                <span className="text-base">Total</span>
                <span className="text-2xl">${((invoice as any).total ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        {(invoice as any).notes && (
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm">{(invoice as any).notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer text */}
        {biz?.invoiceFooterText && (
          <p className="text-xs text-center text-muted-foreground pt-2 pb-4">{biz.invoiceFooterText}</p>
        )}

        {/* Stripe payment link */}
        {(invoice as any).stripePaymentUrl && (invoice as any).status !== 'paid' && (
          <div className="flex justify-center print:hidden">
            <a
              href={(invoice as any).stripePaymentUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" className="gap-2">
                Pay Invoice — ${((invoice as any).total ?? 0).toFixed(2)}
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
