import { usePortalGetInvoice } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/format";
import { ArrowLeft, CheckCircle2, AlertCircle, FileText, Calendar, Hash } from "lucide-react";
import { Link } from "wouter";

export default function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const invoiceId = parseInt(params.id ?? "0", 10);
  const { data: invoice, isLoading, isError } = usePortalGetInvoice(invoiceId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="outline">Draft</Badge>;
      case "sent":
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            Pending Payment
          </Badge>
        );
      case "paid":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Paid
          </Badge>
        );
      case "overdue":
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" /> Overdue
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <Link href="/invoices">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Invoices
          </Button>
        </Link>
        <Card className="border-dashed shadow-none bg-muted/20">
          <CardContent className="p-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-2">Invoice not found</h3>
            <p className="text-muted-foreground">This invoice doesn't exist or you don't have access to it.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPending = invoice.status === "sent" || invoice.status === "overdue";
  const allItems = [
    ...(invoice.lineItems ?? []).map((item: any) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    ...(invoice.jobParts ?? []).map((part: any) => ({
      description: part.name,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
      total: part.total,
    })),
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl mx-auto">
      {/* Back nav */}
      <Link href="/invoices">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back to Invoices
        </Button>
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Hash className="w-6 h-6 text-muted-foreground" />
            {invoice.invoiceNumber}
          </h1>
          <div className="flex items-center gap-3 mt-2">
            {getStatusBadge(invoice.status)}
            {invoice.paidAt && (
              <div className="text-sm text-muted-foreground">
                <span>Paid {formatDate(invoice.paidAt)}</span>
                {invoice.paymentMethod && (
                  <span className="capitalize">
                    {' '}· {String(invoice.paymentMethod).replace('_', ' ')}
                    {invoice.paymentCardBrand ? ` · ${invoice.paymentCardBrand}` : ''}
                    {invoice.paymentCardLast4 ? ` ending ${invoice.paymentCardLast4}` : ''}
                    {invoice.paymentReference ? ` · Ref ${invoice.paymentReference}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total</p>
          <p className="text-4xl font-bold text-foreground">{formatCurrency(invoice.total)}</p>
        </div>
      </div>

      {/* Meta info */}
      <Card className="shadow-sm">
        <CardContent className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Issued</p>
            <div className="flex items-center gap-1.5 text-foreground font-medium">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {formatDate(invoice.createdAt)}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Due Date</p>
            <div className={`flex items-center gap-1.5 font-medium ${invoice.status === "overdue" ? "text-destructive" : "text-foreground"}`}>
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Status</p>
            {getStatusBadge(invoice.status)}
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Line Items</h2>
          {allItems.length > 0 ? (
            <div className="space-y-3">
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider pb-2 border-b border-border">
                <span className="col-span-6">Description</span>
                <span className="col-span-2 text-right">Qty</span>
                <span className="col-span-2 text-right">Unit Price</span>
                <span className="col-span-2 text-right">Total</span>
              </div>
              {allItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 text-sm py-1">
                  <span className="col-span-6 text-foreground">{item.description}</span>
                  <span className="col-span-2 text-right text-muted-foreground">{item.quantity}</span>
                  <span className="col-span-2 text-right text-muted-foreground">
                    {item.unitPrice != null ? formatCurrency(item.unitPrice) : "—"}
                  </span>
                  <span className="col-span-2 text-right font-medium text-foreground">
                    {formatCurrency(item.total)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No line items on this invoice.</p>
          )}

          <Separator className="my-4" />

          {/* Totals */}
          <div className="space-y-2">
            {invoice.subtotal != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-foreground">{formatCurrency(invoice.subtotal)}</span>
              </div>
            )}
            {invoice.tax != null && invoice.tax > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span className="text-foreground">{formatCurrency(invoice.tax)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatCurrency(invoice.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action */}
      {isPending && (
        <Card className={`shadow-sm ${invoice.status === "overdue" ? "border-destructive/50 bg-destructive/5" : ""}`}>
          <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-foreground">
                {invoice.status === "overdue" ? "Payment Overdue" : "Payment Due"}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {invoice.dueDate
                  ? `Due ${formatDate(invoice.dueDate)}`
                  : "Please arrange payment at your earliest convenience."}
              </p>
            </div>
            <Button size="lg" className="w-full sm:w-auto shrink-0">
              Pay Now — {formatCurrency(invoice.total)}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
