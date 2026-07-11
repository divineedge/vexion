import React, { useState } from 'react';
import {
  useListInvoices, getListInvoicesQueryKey,
  useGetInvoice, getGetInvoiceQueryKey,
  useGetFinancialsSummary, getGetFinancialsSummaryQueryKey,
  useUpdateInvoice,
  useGetJob, getGetJobQueryKey,
  useListRecurringTemplates, getListRecurringTemplatesQueryKey,
  useCreateRecurringTemplate,
  useUpdateRecurringTemplate,
  useDeleteRecurringTemplate,
  useRunRecurringTemplateNow,
  useGetBillingAutomationStatus, getGetBillingAutomationStatusQueryKey,
  useRetryBillingEmail,
  useListCustomers, getListCustomersQueryKey,
} from '@workspace/api-client-react';
import type { RecurringInvoiceTemplate, BillingLineItem } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Plus, ArrowUpRight, DollarSign, Clock, FileText, CheckCircle, Calendar,
  User, ChevronDown, Package, RefreshCw, Play, Pause, Mail, MailCheck, MailX, Trash2, Pencil,
  Building2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import VendorExpenseLedger from '@/components/financials/VendorExpenseLedger';

const STATUS_COLORS: Record<string, string> = {
  paid:      'bg-emerald-100 text-emerald-800 border-transparent',
  sent:      'bg-blue-100 text-blue-800 border-transparent',
  overdue:   'bg-red-100 text-red-800 border-transparent',
  draft:     'bg-gray-100 text-gray-800 border-transparent',
  cancelled: 'bg-slate-100 text-slate-600 border-transparent',
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-transparent',
  sent:    'bg-emerald-100 text-emerald-800 border-transparent',
  failed:  'bg-red-100 text-red-800 border-transparent',
};

// ── Recurring Template Sheet ──────────────────────────────────────────────────

type LineItemRow = BillingLineItem;

interface TemplateSheetProps {
  open: boolean;
  onClose: () => void;
  editing?: RecurringInvoiceTemplate | null;
  customers: Array<{ id: number; name: string }>;
}

function TemplateSheet({ open, onClose, editing, customers }: TemplateSheetProps) {
  const qc = useQueryClient();
  const createTemplate = useCreateRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();

  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [billingCycleType, setBillingCycleType] = useState<'monthly' | 'weekly'>('monthly');
  const [billingCycleDay, setBillingCycleDay] = useState('1');
  const [nextBillingDate, setNextBillingDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);

  React.useEffect(() => {
    if (editing) {
      setCustomerId(String(editing.customerId));
      setName(editing.name);
      setBillingCycleType(editing.billingCycleType as 'monthly' | 'weekly');
      setBillingCycleDay(String(editing.billingCycleDay));
      setNextBillingDate(editing.nextBillingDate);
      setIsActive(editing.isActive);
      setNotes(editing.notes ?? '');
      const items = (editing.lineItems ?? []) as unknown as LineItemRow[];
      setLineItems(items.length > 0 ? items : [{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
    } else {
      setCustomerId('');
      setName('');
      setBillingCycleType('monthly');
      setBillingCycleDay('1');
      setNextBillingDate('');
      setIsActive(true);
      setNotes('');
      setLineItems([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
    }
  }, [editing, open]);

  const updateLineItem = (index: number, field: keyof LineItemRow, value: string | number) => {
    setLineItems(prev => prev.map((li, i) => {
      if (i !== index) return li;
      const updated = { ...li, [field]: value };
      updated.total = updated.quantity * updated.unitPrice;
      return updated;
    }));
  };

  const subtotal = lineItems.reduce((s, li) => s + li.total, 0);

  const handleSave = () => {
    if (!customerId || !name || !nextBillingDate) {
      toast.error('Customer, name, and next billing date are required');
      return;
    }
    const payload = {
      customerId: parseInt(customerId, 10),
      name,
      billingCycleType,
      billingCycleDay: parseInt(billingCycleDay, 10),
      nextBillingDate,
      isActive,
      notes: notes || undefined,
      lineItems,
    };

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
      onClose();
    };

    if (editing) {
      updateTemplate.mutate(
        { id: editing.id, data: payload },
        { onSuccess: () => { toast.success('Template updated'); invalidate(); }, onError: () => toast.error('Failed to update') },
      );
    } else {
      createTemplate.mutate(
        { data: payload },
        { onSuccess: () => { toast.success('Template created'); invalidate(); }, onError: () => toast.error('Failed to create') },
      );
    }
  };

  const isPending = createTemplate.isPending || updateTemplate.isPending;

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>{editing ? 'Edit Template' : 'New Recurring Template'}</SheetTitle>
          <SheetDescription>Invoices generate automatically on the billing date.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Customer <span className="text-destructive">*</span></label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Template Name <span className="text-destructive">*</span></label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Lawn Maintenance" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Billing Cycle</label>
              <Select value={billingCycleType} onValueChange={v => setBillingCycleType(v as 'monthly' | 'weekly')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Day of {billingCycleType === 'monthly' ? 'Month' : 'Week'}</label>
              <Input
                type="number"
                min={billingCycleType === 'monthly' ? 1 : 0}
                max={billingCycleType === 'monthly' ? 28 : 6}
                value={billingCycleDay}
                onChange={e => setBillingCycleDay(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {billingCycleType === 'monthly' ? '1–28 (day of month)' : '0=Sun, 1=Mon … 6=Sat'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Next Billing Date <span className="text-destructive">*</span></label>
            <Input type="date" value={nextBillingDate} onChange={e => setNextBillingDate(e.target.value)} />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Line Items</label>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                onClick={() => setLineItems(p => [...p, { description: '', quantity: 1, unitPrice: 0, total: 0 }])}
              >
                <Plus className="w-3 h-3" /> Add Line
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-center text-sm">
                  <Input
                    className="col-span-5 h-8 text-xs"
                    placeholder="Description"
                    value={li.description}
                    onChange={e => updateLineItem(i, 'description', e.target.value)}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs"
                    type="number"
                    min={1}
                    placeholder="Qty"
                    value={li.quantity}
                    onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                  />
                  <Input
                    className="col-span-3 h-8 text-xs"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Unit price"
                    value={li.unitPrice}
                    onChange={e => updateLineItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                  />
                  <span className="col-span-1 text-xs text-right font-medium">${li.total.toFixed(0)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-span-1 h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setLineItems(p => p.filter((_, j) => j !== i))}
                    disabled={lineItems.length === 1}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              <div className="flex justify-end text-sm font-semibold text-right pr-8">
                Subtotal: ${subtotal.toFixed(2)}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes on invoice" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Paused templates are skipped by the scheduler</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <Button className="w-full" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [partsExpanded, setPartsExpanded] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringInvoiceTemplate | null>(null);

  const { data: summary } = useGetFinancialsSummary({ query: { queryKey: getGetFinancialsSummaryQueryKey() } });
  const { data: invoices, isLoading } = useListInvoices({}, { query: { queryKey: getListInvoicesQueryKey({}) } });
  const { data: selectedInvoice } = useGetInvoice(selectedInvoiceId!, {
    query: { enabled: selectedInvoiceId != null, queryKey: getGetInvoiceQueryKey(selectedInvoiceId!) },
  });
  const { data: templates, isLoading: templatesLoading } = useListRecurringTemplates({
    query: { queryKey: getListRecurringTemplatesQueryKey() },
  });
  const { data: automationStatus, isLoading: automationLoading } = useGetBillingAutomationStatus({
    query: { queryKey: getGetBillingAutomationStatusQueryKey() },
  });
  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });

  const updateInvoice = useUpdateInvoice();
  const deleteTemplate = useDeleteRecurringTemplate();
  const runNow = useRunRecurringTemplateNow();
  const retryEmail = useRetryBillingEmail();

  // Fetch job for parts breakdown when the invoice is linked to a job
  const jobId = selectedInvoice?.jobId ?? null;
  const { data: linkedJob } = useGetJob(jobId!, {
    query: { enabled: jobId != null, queryKey: getGetJobQueryKey(jobId!) },
  });
  const jobParts = (linkedJob?.jobParts ?? []) as { name: string; quantity: number; unitPrice: number; total: number }[];
  const partsTotal = jobParts.reduce((sum, p) => sum + p.total, 0);

  const customerOptions = (customers?.items ?? []).map(c => ({ id: c.id, name: c.name }));

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

  const handleDeleteTemplate = (id: number, name: string) => {
    if (!window.confirm(`Delete recurring template "${name}"? This will not cancel already-generated invoices.`)) return;
    deleteTemplate.mutate({ id }, {
      onSuccess: () => {
        toast.success('Template deleted');
        qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() });
      },
      onError: () => toast.error('Failed to delete template'),
    });
  };

  const handleRunNow = (id: number) => {
    runNow.mutate({ id }, {
      onSuccess: (data) => {
        toast.success(`Invoice #${(data as { invoiceId: number }).invoiceId} generated`);
        qc.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
      },
      onError: () => toast.error('Failed to generate invoice'),
    });
  };

  const handleRetryEmail = (id: number) => {
    retryEmail.mutate({ id }, {
      onSuccess: () => {
        toast.success('Queued for retry');
        qc.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
      },
      onError: () => toast.error('Failed to retry'),
    });
  };

  const emailQueue = (automationStatus?.emailQueue ?? []) as Array<{
    id: number; invoiceId: number; invoiceNumber: string | null; status: string;
    attempts: number; lastAttemptAt: string | null; errorMsg: string | null; createdAt: string;
  }>;
  const queueStats = automationStatus?.queueStats ?? { pending: 0, sent: 0, failed: 0 };
  const todayInvoices = (automationStatus?.todayInvoices ?? []) as Array<{
    id: number; invoiceNumber: string; total: number; status: string; customerName: string | null; createdAt: string;
  }>;

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

      {/* Tabs */}
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices"><FileText className="w-4 h-4 mr-2" />All Invoices</TabsTrigger>
          <TabsTrigger value="recurring"><RefreshCw className="w-4 h-4 mr-2" />Recurring Billing</TabsTrigger>
          <TabsTrigger value="automation">
            <Mail className="w-4 h-4 mr-2" />Billing Automation
            {(queueStats.pending > 0 || queueStats.failed > 0) && (
              <Badge className="ml-2 h-4 px-1 text-[10px] bg-amber-500 text-white border-transparent">
                {queueStats.pending + queueStats.failed}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="vendors"><Building2 className="w-4 h-4 mr-2" />Vendors & Expenses</TabsTrigger>
        </TabsList>

        {/* ── All Invoices ── */}
        <TabsContent value="invoices">
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
                      <TableRow key={invoice.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedInvoiceId(invoice.id)}>
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
        </TabsContent>

        {/* ── Recurring Billing ── */}
        <TabsContent value="recurring" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Recurring Invoice Templates</h3>
              <p className="text-sm text-muted-foreground">Automatically generate invoices on a fixed schedule for contracted clients.</p>
            </div>
            <Button className="gap-2" onClick={() => { setEditingTemplate(null); setTemplateSheetOpen(true); }}>
              <Plus className="w-4 h-4" /> New Template
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Monthly Value</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templatesLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading templates...</TableCell></TableRow>
                  ) : (templates ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No recurring templates. Create one to automate billing.</TableCell></TableRow>
                  ) : (
                    (templates ?? []).map(t => {
                      const lineItems = (t.lineItems ?? []) as Array<{ quantity: number; unitPrice: number }>;
                      const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell className="text-muted-foreground">{t.customerName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground capitalize">
                            {t.billingCycleType} · day {t.billingCycleDay}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                              {t.nextBillingDate}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={t.isActive
                                ? 'bg-emerald-100 text-emerald-800 border-transparent'
                                : 'bg-slate-100 text-slate-600 border-transparent'}
                              variant="outline"
                            >
                              {t.isActive ? 'Active' : 'Paused'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">${subtotal.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                title="Generate now"
                                onClick={() => handleRunNow(t.id)}
                                disabled={runNow.isPending}
                              >
                                <Play className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                title="Edit"
                                onClick={() => { setEditingTemplate(t); setTemplateSheetOpen(true); }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                title="Delete"
                                onClick={() => handleDeleteTemplate(t.id, t.name)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Billing Automation ── */}
        <TabsContent value="automation" className="space-y-6">
          {/* Queue stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Emails Pending', value: queueStats.pending, icon: Mail, color: 'text-amber-500 bg-amber-500/10' },
              { label: 'Emails Sent',    value: queueStats.sent,    icon: MailCheck, color: 'text-emerald-500 bg-emerald-500/10' },
              { label: 'Emails Failed',  value: queueStats.failed,  icon: MailX, color: 'text-destructive bg-destructive/10' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${color}`}><Icon className="w-4 h-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold">{value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Today's auto-generated invoices */}
          <div className="space-y-2">
            <h3 className="font-semibold">Invoices Generated Today</h3>
            {automationLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
            ) : todayInvoices.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No invoices auto-generated today.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Generated</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {todayInvoices.map(inv => (
                        <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedInvoiceId(inv.id)}>
                          <TableCell className="font-mono text-sm font-medium">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-muted-foreground">{inv.customerName}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[inv.status] ?? ''} variant="outline">{inv.status.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{format(new Date(inv.createdAt), 'h:mm a')}</TableCell>
                          <TableCell className="text-right font-medium">${inv.total.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Email queue */}
          <div className="space-y-2">
            <h3 className="font-semibold">Email Queue</h3>
            {automationLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
            ) : emailQueue.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Email queue is empty.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Last Attempt</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emailQueue.map(entry => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono text-sm">{entry.invoiceNumber ?? `#${entry.invoiceId}`}</TableCell>
                          <TableCell>
                            <Badge className={EMAIL_STATUS_COLORS[entry.status] ?? ''} variant="outline">
                              {entry.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{entry.attempts}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {entry.lastAttemptAt ? format(new Date(entry.lastAttemptAt), 'MMM d, h:mm a') : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-destructive truncate max-w-[200px]">{entry.errorMsg ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            {entry.status === 'failed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => handleRetryEmail(entry.id)}
                                disabled={retryEmail.isPending}
                              >
                                <RefreshCw className="w-3 h-3" /> Retry
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Vendors & Expenses ── */}
        <TabsContent value="vendors">
          <VendorExpenseLedger canEdit={canManageOffice} />
        </TabsContent>
      </Tabs>

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

                {/* Parts used (loaded from linked job) */}
                {selectedInvoice.jobId && jobParts.length > 0 && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between text-left"
                      onClick={() => setPartsExpanded(e => !e)}
                    >
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Parts Used</p>
                        <span className="text-xs font-semibold text-foreground ml-1">${partsTotal.toFixed(2)}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${partsExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {partsExpanded && (
                      <div className="rounded-lg border divide-y text-sm">
                        {jobParts.map((part, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium block truncate">{part.name}</span>
                              <span className="text-xs text-muted-foreground">{part.quantity} × ${part.unitPrice.toFixed(2)}</span>
                            </div>
                            <span className="font-medium ml-4">${part.total.toFixed(2)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30 font-semibold">
                          <span>Parts Total</span>
                          <span>${partsTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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

      {/* Template Sheet */}
      <TemplateSheet
        open={templateSheetOpen}
        onClose={() => { setTemplateSheetOpen(false); setEditingTemplate(null); }}
        editing={editingTemplate}
        customers={customerOptions}
      />
    </div>
  );
}
