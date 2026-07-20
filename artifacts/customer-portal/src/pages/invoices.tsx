import { usePortalListInvoices } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, Download, CheckCircle2, AlertCircle, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";

export default function Invoices() {
  const { data: invoices, isLoading } = usePortalListInvoices();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="outline">Draft</Badge>;
      case "sent": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Pending Payment</Badge>;
      case "paid": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Paid</Badge>;
      case "overdue": return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1"/> Overdue</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingInvoices = invoices?.filter(i => i.status === 'sent' || i.status === 'overdue') || [];
  const paidInvoices = invoices?.filter(i => i.status === 'paid') || [];

  const InvoiceCard = ({ invoice }: { invoice: any }) => (
    <Link href={`/invoices/${invoice.id}`}>
      <Card className={`shadow-sm overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-md transition-all ${invoice.status === 'overdue' ? 'border-destructive/50' : ''}`}>
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
                <p className="text-3xl font-bold text-foreground">{formatCurrency(invoice.total)}</p>
              </div>

              {invoice.status === 'sent' || invoice.status === 'overdue' ? (
                <Button className="w-full" onClick={(e) => e.stopPropagation()}>Pay Now</Button>
              ) : (
                <Button variant="outline" className="w-full" size="sm" onClick={(e) => e.stopPropagation()}>
                  <Download className="w-4 h-4 mr-2" /> Receipt
                </Button>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

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
            {formatCurrency(pendingInvoices.reduce((sum, inv) => sum + inv.total, 0))}
          </div>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="pending">
            Pending ({pendingInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="paid">Paid History</TabsTrigger>
        </TabsList>
        
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
