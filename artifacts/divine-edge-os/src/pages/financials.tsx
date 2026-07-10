import React, { useState } from 'react';
import {
  useListInvoices, getListInvoicesQueryKey,
  useGetInvoice, getGetInvoiceQueryKey,
  useGetFinancialsSummary, getGetFinancialsSummaryQueryKey,
  useUpdateInvoice,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, ArrowUpRight, DollarSign, Clock, FileText, CheckCircle, Calendar, User } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  paid:      'bg-emerald-100 text-emerald-800 border-transparent',
  sent:      'bg-blue-100 text-blue-800 border-transparent',
  overdue:   'bg-red-100 text-red-800 border-transparent',
  draft:     'bg-gray-100 text-gray-800 border-transparent',
  cancelled: 'bg-slate-100 text-slate-600 border-transparent',
};

export default function FinancialsPage() {
  const qc = useQueryClient();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const { data: summary } = useGetFinancialsSummary({ query: { queryKey: getGetFinancialsSummaryQueryKey() } });
  const { data: invoices, isLoading } = useListInvoices({}, { query: { queryKey: getListInvoicesQueryKey({}) } });
  const { data: selectedInvoice } = useGetInvoice(selectedInvoiceId!, {
    query: { enabled: selectedInvoiceId != null, queryKey: getGetInvoiceQueryKey(selectedInvoiceId!) },
  });

  const updateInvoice = useUpdateInvoice();

  const handleStatusChange = (status: string) => {
    if (!selectedInvoiceId) return;
    updateInvoice.mutate(
      { id: selectedInvoiceId, data: { status: status as Parameters<typeof updateInvoice.mutate>[0]['data']['status'] } },
      {
        onSuccess: () => {
          toast.success('Invoice updated');
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(selectedInvoiceId) });
          qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
        },
        onError: () => toast.error('Failed to update invoice'),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financials</h1>
          <p className="text-muted-foreground mt-1">Invoicing, payments, and revenue tracking.</p>
        </div>
        <Button className="gap-2"><Plus className="w-4 h-4" /> Create Invoice</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue',    value: summary?.totalRevenue,    icon: DollarSign,   color: 'text-primary bg-primary/10' },
          { label: 'Outstanding',      value: summary?.totalOutstanding, icon: Clock,        color: 'text-amber-500 bg-amber-500/10' },
          { label: 'Overdue',          value: summary?.totalOverdue,     icon: ArrowUpRight, color: 'text-destructive bg-destructive/10', destructive: true },
          { label: 'Paid This Month',  value: summary?.paidThisMonth,    icon: CheckCircle,  color: 'text-emerald-500 bg-emerald-500/10' },
        ].map(({ label, value, icon: Icon, color, destructive }) => (
          <Card key={label}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className={`text-sm font-medium ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>{label}</p>
                  <p className={`text-3xl font-bold mt-1 ${destructive ? 'text-destructive' : ''}`}>
                    ${(value ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className={`p-2 rounded-lg ${color}`}><Icon className="w-5 h-5" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoice Table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> All Invoices</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">Filter</Button>
              <Button variant="outline" size="sm">Export</Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading invoices...</TableCell></TableRow>
              ) : invoices?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
              ) : (
                invoices?.map(invoice => (
                  <TableRow
                    key={invoice.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                  >
                    <TableCell className="font-medium font-mono text-sm">{invoice.invoiceNumber}</TableCell>
                    <TableCell>{invoice.customerName}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[invoice.status] ?? ''} variant="outline">
                        {invoice.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(invoice.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${invoice.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invoice Detail Sheet */}
      <Sheet open={selectedInvoiceId != null} onOpenChange={open => { if (!open) setSelectedInvoiceId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedInvoice ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="font-mono text-xl">{selectedInvoice.invoiceNumber}</SheetTitle>
                    <SheetDescription className="mt-1">
                      Created {format(new Date(selectedInvoice.createdAt), 'MMMM d, yyyy')}
                    </SheetDescription>
                  </div>
                  <Badge className={`shrink-0 ${STATUS_COLORS[selectedInvoice.status] ?? ''}`} variant="outline">
                    {selectedInvoice.status.toUpperCase()}
                  </Badge>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                {/* Update Status */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={selectedInvoice.status} onValueChange={handleStatusChange} disabled={updateInvoice.isPending}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedInvoice.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /><span>{selectedInvoice.customerName}</span></div>
                    </div>
                  )}
                  {selectedInvoice.dueDate && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Due Date</p>
                      <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /><span>{format(new Date(selectedInvoice.dueDate), 'MMM d, yyyy')}</span></div>
                    </div>
                  )}
                  {selectedInvoice.paidAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Paid On</p>
                      <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /><span>{format(new Date(selectedInvoice.paidAt), 'MMM d, yyyy')}</span></div>
                    </div>
                  )}
                </div>

                {selectedInvoice.notes && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</p>
                      <p className="text-sm">{selectedInvoice.notes}</p>
                    </div>
                  </>
                )}

                <Separator />

                {/* Line Items */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Line Items</p>
                  <div className="rounded-lg border divide-y text-sm">
                    {selectedInvoice.lineItems && selectedInvoice.lineItems.length > 0 ? (
                      selectedInvoice.lineItems.map(li => (
                        <div key={li.id} className="flex items-center justify-between px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium block truncate">{li.description}</span>
                            <span className="text-xs text-muted-foreground">{li.quantity} × ${li.unitPrice.toFixed(2)}</span>
                          </div>
                          <span className="font-medium ml-4">${li.total.toFixed(2)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-muted-foreground text-center text-xs">No line items</div>
                    )}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border divide-y text-sm">
                  <div className="flex justify-between px-3 py-2 text-muted-foreground">
                    <span>Subtotal</span>
                    <span>${selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 text-muted-foreground">
                    <span>Tax</span>
                    <span>${selectedInvoice.tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5 font-semibold bg-muted/30">
                    <span>Total</span>
                    <span>${selectedInvoice.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
