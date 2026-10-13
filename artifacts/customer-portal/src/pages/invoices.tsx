import { usePortalListInvoices, customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PayInvoiceAction } from "@/components/PayInvoiceAction";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, Download, CheckCircle2, AlertCircle, ChevronRight, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation, useSearch } from "wouter";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Invoices() {
  const [, navigate] = useLocation();
  const { data: invoices, isLoading, refetch } = usePortalListInvoices();
  const search = useSearch();
  const queryClient = useQueryClient();
  const [payingId, setPayingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceDateFrom, setInvoiceDateFrom] = useState('');
  const [invoiceDateTo, setInvoiceDateTo] = useState('');

  // Detect Stripe redirect-back and show a success message
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("payment") === "success") {
      toast.success("Payment received! Your invoice will update shortly.", { description: "Saved cards can be managed from your Profile." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["portal-payment-method"] });
      setTimeout(() => refetch(), 4000);
      // Clean the query param from the URL without a full reload
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, [search, refetch, queryClient]);

  async function downloadPdf(e: React.MouseEvent, invoiceId: number, invoiceNumber: string) {
    e.preventDefault();
    e.stopPropagation();
    if (downloadingId !== null) return;
    setDownloadingId(invoiceId);
    try {
      const blob = await customFetch<Blob>(`/api/portal/invoices/${invoiceId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Couldn't download the PDF. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="outline">Draft</Badge>;
      case "sent": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Pending Payment</Badge>;
      case "paid": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Paid</Badge>;
      case "overdue": return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1"/> Overdue</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const allFiltered = (invoices ?? []).filter(i =>
    (!invoiceSearch.trim() || i.invoiceNumber.toLowerCase().includes(invoiceSearch.toLowerCase())) &&
    (!invoiceDateFrom || (i.createdAt ?? '') >= invoiceDateFrom) &&
    (!invoiceDateTo || (i.createdAt ?? '') <= invoiceDateTo + 'T23:59:59')
  );
  const pendingInvoices = allFiltered.filter(i => i.status === 'sent' || i.status === 'overdue');
  const paidInvoices = allFiltered.filter(i => i.status === 'paid');

  const InvoiceCard = ({ invoice }: { invoice: any }) => {
    const isPaying = payingId === invoice.id;
    const isPayable = invoice.status === 'sent' || invoice.status === 'overdue';

    return (
        <Card role="link" tabIndex={0} onClick={() => navigate(`/invoices/${invoice.id}`)}
          onKeyDown={event => { if(event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {event.preventDefault();navigate(`/invoices/${invoice.id}`);} }}
          className={`shadow-sm overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-md transition-all ${invoice.status === 'overdue' ? 'border-destructive/50' : ''}`}>
          <CardContent className="p-0">
            <div className="flex flex-col sm:flex-row items-center">
              <div className="p-6 flex-1 w-full border-b sm:border-b-0 sm:border-r border-border">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">{invoice.invoiceNumber}</h3>
                    <div className="flex gap-2 items-center">
                      <p className="text-sm text-muted-foreground">Issued {formatDate(invoice.createdAt)}</p>
                      <span className="text-muted-foreground">•</span>
                      <p className={`text-sm ${invoice.status === 'overdue' ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                        Due {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    {invoice.paidAt && (
                      <p className="text-xs text-green-700 mt-2">
                        Paid {formatDate(invoice.paidAt)}
                        {invoice.paymentMethod ? ` by ${String(invoice.paymentMethod).replace('_', ' ')}` : ''}
                        {invoice.paymentCardBrand ? ` · ${invoice.paymentCardBrand}` : ''}
                        {invoice.paymentCardLast4 ? ` ending ${invoice.paymentCardLast4}` : ''}
                        {invoice.paymentReference ? ` · Ref ${invoice.paymentReference}` : ''}
                      </p>
                    )}
                  </div>
                  {getStatusBadge(invoice.status)}
                </div>

                {(invoice.lineItems?.length > 0 || invoice.jobParts?.length > 0) && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Items</p>
                    <ul className="space-y-2">
                      {invoice.lineItems?.map((item: any) => (
                        <li key={item.id} className="flex justify-between text-sm">
                          <span className="text-foreground">{item.description} <span className="text-muted-foreground">x{item.quantity}</span></span>
                          <span className="font-medium">{formatCurrency(item.total)}</span>
                        </li>
                      ))}
                      {invoice.jobParts?.map((part: any, idx: number) => (
                        <li key={`part-${idx}`} className="flex justify-between text-sm">
                          <span className="text-foreground">{part.name} <span className="text-muted-foreground">x{part.quantity}</span></span>
                          <span className="font-medium">{formatCurrency(part.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-6 bg-muted/10 flex flex-col justify-center items-center sm:items-end w-full sm:w-48 gap-4">
                <div className="text-center sm:text-right">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Total</p>
                  <p className="text-3xl font-bold text-foreground">{formatCurrency((invoice as any).balanceDue ?? invoice.total)}</p>
                  {((invoice as any).creditApplied ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">of {formatCurrency(invoice.total)} after {formatCurrency((invoice as any).creditApplied)} prepaid credit</p>
                  )}
                </div>

                {isPayable ? (
                  <PayInvoiceAction
                    invoiceId={invoice.id}
                    returnPath="invoices"
                    compact
                    disabled={payingId !== null && !isPaying}
                    onStart={() => setPayingId(invoice.id)}
                    onFail={() => setPayingId(null)}
                  />
                ) : null}
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={downloadingId === invoice.id}
                  onClick={(e) => downloadPdf(e, invoice.id, invoice.invoiceNumber)}
                >
                  {downloadingId === invoice.id
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Download className="w-4 h-4 mr-2" />}
                  Download PDF
                </Button>
                <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
              </div>
            </div>
          </CardContent>
        </Card>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing & Invoices</h1>
          <p className="text-muted-foreground mt-1">Manage your payments and download past receipts.</p>
        </div>
        <div className="bg-card border rounded-lg px-4 py-2 flex items-center gap-4">
          <div className="text-sm text-muted-foreground">Total Balance Due</div>
          <div className="text-2xl font-bold text-destructive">
            {formatCurrency(pendingInvoices.reduce((sum, inv) => sum + ((inv as any).balanceDue ?? inv.total), 0))}
          </div>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <TabsList className="grid max-w-xs grid-cols-2">
            <TabsTrigger value="pending">Pending ({pendingInvoices.length})</TabsTrigger>
            <TabsTrigger value="paid">Paid History</TabsTrigger>
          </TabsList>
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} placeholder="Search by invoice #…" className="h-8 text-sm pl-7 w-48" />
          </div>
          <input type="date" value={invoiceDateFrom} onChange={e => setInvoiceDateFrom(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-input bg-background" title="From date" />
          <input type="date" value={invoiceDateTo} onChange={e => setInvoiceDateTo(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-input bg-background" title="To date" />
          {(invoiceDateFrom || invoiceDateTo) && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setInvoiceDateFrom(''); setInvoiceDateTo(''); }}>Clear</button>
          )}
        </div>
        
        <TabsContent value="pending" className="mt-6 space-y-4">
          {isLoading ? (
            Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
          ) : pendingInvoices.length > 0 ? (
            pendingInvoices.map(invoice => <InvoiceCard key={invoice.id} invoice={invoice} />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">All caught up!</h3>
                <p className="text-muted-foreground">You have no pending invoices to pay.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="paid" className="mt-6 space-y-4">
          {isLoading ? (
            Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
          ) : paidInvoices.length > 0 ? (
            paidInvoices.map(invoice => <InvoiceCard key={invoice.id} invoice={invoice} />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No billing history</h3>
                <p className="text-muted-foreground">You haven't made any payments yet.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
