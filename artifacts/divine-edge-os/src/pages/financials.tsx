import React, { useState, useEffect } from 'react';
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
  usePreviewRecurringTemplateBilling, getPreviewRecurringTemplateBillingQueryKey,
  useGetBillingAutomationStatus, getGetBillingAutomationStatusQueryKey,
  useRetryBillingEmail,
  useListCustomers, getListCustomersQueryKey,
  usePrintMailInvoice,
  useSendInvoiceReminder,
  useListStopServiceFlags, getListStopServiceFlagsQueryKey,
  useApproveStopServiceFlag,
  useDismissStopServiceFlag,
  useResumeStopServiceFlagPlan,
  useListPlanCancelRequests, getListPlanCancelRequestsQueryKey,
  useApprovePlanCancelRequest,
  useDismissPlanCancelRequest,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useCreateInvoice,
  useUpdateJob,
  customFetch,
} from '@workspace/api-client-react';
import type { RecurringInvoiceTemplate, BillingLineItem, StopServiceFlag, PlanCancelRequest, BillingPreviewGroup, BillingPreviewJob } from '@workspace/api-client-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import { Card, CardContent } from '@/components/ui/card';
import { printInvoice } from '@/lib/printUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Plus, ArrowUpRight, DollarSign, Clock, FileText, CheckCircle, CheckCircle2, Calendar,
  User, ChevronDown, Package, RefreshCw, Play, Pause, Mail, MailCheck, MailX, Trash2, Pencil,
  Building2, ShieldAlert, Check, X, Phone, Globe, Eye, AlertTriangle, Search, Printer, Send,
  Briefcase, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import VendorExpenseLedger from '@/components/financials/VendorExpenseLedger';

const STATUS_COLORS: Record<string, string> = {
  paid:      'bg-emerald-100 text-emerald-800 border-transparent',
  sent:      'bg-blue-100 text-blue-800 border-transparent',
  overdue:   'bg-red-100 text-red-800 border-transparent',
  draft:     'bg-gray-100 text-gray-800 border-transparent',
  cancelled: 'bg-slate-100 text-slate-600 border-transparent',
  write_off: 'bg-purple-100 text-purple-800 border-transparent',
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-transparent',
  sent:    'bg-emerald-100 text-emerald-800 border-transparent',
  failed:  'bg-red-100 text-red-800 border-transparent',
};

// ── Recurring Template Sheet ──────────────────────────────────────────────────

type LineItemRow = BillingLineItem;
type BillingCycleType = 'daily' | 'weekly' | 'monthly';
type BillingMode = 'static' | 'completed_work';

interface ServiceOption {
  id: number;
  name: string;
}

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

  const { data: services } = useQuery<ServiceOption[]>({
    queryKey: ['services', 'recurring-template-picker'],
    queryFn: () => customFetch<ServiceOption[]>('/api/services?activeOnly=true'),
    enabled: open,
  });

  const [customerId, setCustomerId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [name, setName] = useState('');
  const [billingMode, setBillingMode] = useState<BillingMode>('static');
  const [billingCycleType, setBillingCycleType] = useState<BillingCycleType>('monthly');
  const [billingCycleDay, setBillingCycleDay] = useState('1');
  const [nextBillingDate, setNextBillingDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);

  React.useEffect(() => {
    if (editing) {
      setCustomerId(editing.customerId != null ? String(editing.customerId) : '');
      setServiceId(editing.serviceId != null ? String(editing.serviceId) : '');
      setName(editing.name);
      setBillingMode((editing.billingMode as BillingMode) ?? 'static');
      setBillingCycleType(editing.billingCycleType as BillingCycleType);
      setBillingCycleDay(String(editing.billingCycleDay));
      setNextBillingDate(editing.nextBillingDate);
      setIsActive(editing.isActive);
      setNotes(editing.notes ?? '');
      const items = (editing.lineItems ?? []) as unknown as LineItemRow[];
      setLineItems(items.length > 0 ? items : [{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
    } else {
      setCustomerId('');
      setServiceId('');
      setName('');
      setBillingMode('static');
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
    if (!name || !nextBillingDate) {
      toast.error('Name and next billing date are required');
      return;
    }
    if (!customerId && !serviceId) {
      toast.error('Scope the template to a customer, a service, or both');
      return;
    }
    if (billingMode === 'static' && !customerId) {
      toast.error('Static line-item templates require a customer');
      return;
    }
    const payload = {
      customerId: customerId ? parseInt(customerId, 10) : undefined,
      serviceId: serviceId ? parseInt(serviceId, 10) : undefined,
      name,
      billingMode,
      billingCycleType,
      billingCycleDay: parseInt(billingCycleDay, 10),
      nextBillingDate,
      isActive,
      notes: notes || undefined,
      lineItems: billingMode === 'static' ? lineItems : [],
    };

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
      onClose();
    };

    if (editing) {
      updateTemplate.mutate(
        { id: editing.id, data: { ...payload, customerId: customerId ? parseInt(customerId, 10) : null, serviceId: serviceId ? parseInt(serviceId, 10) : null } },
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Customer {billingMode === 'static' && <span className="text-destructive">*</span>}
              </label>
              <Select value={customerId || '__none__'} onValueChange={v => setCustomerId(v === '__none__' ? '' : v)}>
                <SelectTrigger title="Scope this recurring invoice to a specific customer (leave blank for service-only)"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service</label>
              <Select value={serviceId || '__none__'} onValueChange={v => setServiceId(v === '__none__' ? '' : v)}>
                <SelectTrigger title="Scope this recurring invoice to a specific service type (leave blank for customer-only)"><SelectValue placeholder="Select service" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {(services ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Scope to a customer, a service, or both. Service-only templates bill every customer with qualifying completed work.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Template Name <span className="text-destructive">*</span></label>
            <Input title="Internal name for this recurring invoice template" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Lawn Maintenance" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Billing Source</label>
            <Select value={billingMode} onValueChange={v => setBillingMode(v as BillingMode)}>
              <SelectTrigger title="Choose how line items are determined each billing cycle"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Fixed line items (hand-entered)</SelectItem>
                <SelectItem value="completed_work">Bill from completed work</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {billingMode === 'static'
                ? 'Bills the same line items below every cycle.'
                : 'Builds the invoice from jobs completed since the last billing run, instead of static line items.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Billing Cycle</label>
              <Select value={billingCycleType} onValueChange={v => setBillingCycleType(v as BillingCycleType)}>
                <SelectTrigger title="Select how often to bill the customer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {billingCycleType !== 'daily' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Day of {billingCycleType === 'monthly' ? 'Month' : 'Week'}</label>
                <Input
                  type="number"
                  min={billingCycleType === 'monthly' ? 1 : 0}
                  max={billingCycleType === 'monthly' ? 28 : 6}
                  title={billingCycleType === 'monthly' ? 'Day of month to bill (1–28)' : 'Day of week to bill (0=Sun, 1=Mon … 6=Sat)'}
                  value={billingCycleDay}
                  onChange={e => setBillingCycleDay(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {billingCycleType === 'monthly' ? '1–28 (day of month)' : '0=Sun, 1=Mon … 6=Sat'}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Next Billing Date <span className="text-destructive">*</span></label>
            <Input type="date" title="First billing date — future charges will follow the billing cycle from this date" value={nextBillingDate} onChange={e => setNextBillingDate(e.target.value)} />
          </div>

          <Separator />

          {billingMode === 'static' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Line Items</label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1"
                  title="Add a new line item to this recurring template"
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
                      title="Line item description"
                      placeholder="Description"
                      value={li.description}
                      onChange={e => updateLineItem(i, 'description', e.target.value)}
                    />
                    <Input
                      className="col-span-2 h-8 text-xs"
                      type="number"
                      min={1}
                      title="Quantity of units to bill"
                      placeholder="Qty"
                      value={li.quantity}
                      onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                    <Input
                      className="col-span-3 h-8 text-xs"
                      type="number"
                      min={0}
                      step={0.01}
                      title="Price per unit for this line item"
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
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Line items aren't entered here — each invoice will be built automatically from the completed jobs
              matching this template's scope since the last billing run.
            </div>
          )}

          <Separator />

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Input title="Optional notes that will appear on every invoice generated from this template" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes on invoice" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Paused templates are skipped by the scheduler</p>
            </div>
            <Switch title="Active templates run automatically; paused templates are skipped by the scheduler" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <Button title={editing ? 'Save changes to this recurring billing template' : 'Create this recurring billing template'} className="w-full" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Create Invoice Sheet ────────────────────────────────────────────────────────

interface CreateInvoiceSheetProps {
  open: boolean;
  onClose: () => void;
  customers: Array<{ id: number; name: string }>;
  invoiceDueDays?: number | null;
}

function CreateInvoiceSheet({ open, onClose, customers, invoiceDueDays }: CreateInvoiceSheetProps) {
  const qc = useQueryClient();
  const createInvoice = useCreateInvoice();

  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemRow[]>([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);

  React.useEffect(() => {
    if (open) {
      setCustomerId('');
      // Auto-compute due date from tenant setting (default 30 days)
      const days = invoiceDueDays ?? 30;
      const due = new Date();
      due.setDate(due.getDate() + days);
      setDueDate(due.toISOString().slice(0, 10));
      setNotes('');
      setLineItems([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
    }
  }, [open, invoiceDueDays]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const cid = (e as CustomEvent<string>).detail;
      if (cid) setCustomerId(cid);
    };
    document.addEventListener('financials:prefillCustomer', handler);
    return () => document.removeEventListener('financials:prefillCustomer', handler);
  }, []);

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
    if (!customerId) {
      toast.error('Customer is required');
      return;
    }
    const validLineItems = lineItems.filter(li => li.description.trim() !== '');
    createInvoice.mutate(
      {
        data: {
          customerId: parseInt(customerId, 10),
          notes: notes || undefined,
          dueDate: dueDate || undefined,
          lineItems: validLineItems.length > 0 ? validLineItems : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success('Invoice created');
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
          onClose();
        },
        onError: () => toast.error('Failed to create invoice'),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Create Invoice</SheetTitle>
          <SheetDescription>Create a one-off invoice for a customer.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Customer <span className="text-destructive">*</span></label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger title="Customer this invoice is for"><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                <div className="px-2 pb-1">
                  <input
                    title="Search for a customer by name"
                    className="w-full text-sm border-b border-border bg-transparent py-1 outline-none placeholder:text-muted-foreground"
                    placeholder="Search…"
                    onChange={e => setCustomerSearch(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                  />
                </div>
                {customers.filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase())).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Due Date</label>
            <Input type="date" title="Payment due date for this invoice" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Line Items</label>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                title="Add a new line item to this invoice"
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
                    title="Line item description"
                    placeholder="Description"
                    value={li.description}
                    onChange={e => updateLineItem(i, 'description', e.target.value)}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs"
                    type="number"
                    min={1}
                    title="Quantity"
                    placeholder="Qty"
                    value={li.quantity}
                    onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                  />
                  <Input
                    className="col-span-3 h-8 text-xs"
                    type="number"
                    min={0}
                    step={0.01}
                    title="Price per unit"
                    placeholder="Unit price"
                    value={li.unitPrice}
                    onChange={e => updateLineItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                  />
                  <span className="col-span-1 text-xs text-right font-medium">${li.total.toFixed(0)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-span-1 h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Remove this line item"
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
            <Input title="Optional notes printed at the bottom of this invoice" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes on invoice" />
          </div>

          <Button className="w-full" title="Create and save the invoice" onClick={handleSave} disabled={createInvoice.isPending}>
            {createInvoice.isPending ? 'Creating...' : 'Create Invoice'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Preview Billing Dialog ──────────────────────────────────────────────────────

interface PreviewBillingDialogProps {
  templateId: number | null;
  templateName: string | null;
  onClose: () => void;
  onGenerate: (excludeJobIds: number[]) => void;
  isGenerating: boolean;
}

function PreviewBillingDialog({ templateId, templateName, onClose, onGenerate, isGenerating }: PreviewBillingDialogProps) {
  const [excludedJobIds, setExcludedJobIds] = useState<Set<number>>(new Set());
  // Jobs whose holdFromBilling flag is being toggled right now (optimistic loading state)
  const [pendingHolds, setPendingHolds] = useState<Set<number>>(new Set());
  const qc = useQueryClient();

  const { data: preview, isLoading } = usePreviewRecurringTemplateBilling(templateId!, {
    query: { enabled: templateId != null, queryKey: getPreviewRecurringTemplateBillingQueryKey(templateId!) },
  });

  const { mutateAsync: updateJob } = useUpdateJob();

  React.useEffect(() => {
    setExcludedJobIds(new Set());
    setPendingHolds(new Set());
  }, [templateId]);

  const toggleJob = (jobId: number) => {
    setExcludedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  };

  /** Toggle the persistent DB hold for overnight billing. */
  const toggleHold = async (jobId: number, currentHeld: boolean) => {
    setPendingHolds(prev => new Set(prev).add(jobId));
    try {
      await updateJob({ id: jobId, data: { holdFromBilling: !currentHeld } });
      // Refresh preview so the badge reflects the new state
      qc.invalidateQueries({ queryKey: getPreviewRecurringTemplateBillingQueryKey(templateId!) });
    } finally {
      setPendingHolds(prev => { const n = new Set(prev); n.delete(jobId); return n; });
    }
  };

  const groups = (preview?.groups ?? []) as BillingPreviewGroup[];
  const includedTotal = groups.reduce(
    (sum, g) => sum + g.jobs.filter(j => !excludedJobIds.has(j.id)).reduce((s, j) => s + j.totalAmount, 0),
    0,
  );
  const totalJobCount = groups.reduce((sum, g) => sum + g.jobs.length, 0);
  const includedJobCount = totalJobCount - excludedJobIds.size;

  const flaggedJobs = groups.flatMap(g => g.jobs).filter(j => j.flags?.duplicate || j.flags?.outlier);
  const flagCount = flaggedJobs.length;

  return (
    <Dialog open={templateId != null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview: {templateName}</DialogTitle>
          <DialogDescription>
            Completed jobs that would be billed if you generate this invoice now. Uncheck a job to leave it out of this run, or use "Hold" to keep it out of the automatic overnight run too.
          </DialogDescription>
        </DialogHeader>

        {flagCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <span>
              <span className="font-semibold">{flagCount} job{flagCount === 1 ? '' : 's'} flagged</span> — review highlighted rows before billing.
              Flags are advisory only; you can still include flagged jobs.
            </span>
          </div>
        )}
        {(() => {
          const heldCount = groups.flatMap((g: BillingPreviewGroup) => g.jobs).filter(j => (j as any).holdFromBilling).length;
          return heldCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <Pause className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
              <span>
                <span className="font-semibold">{heldCount} job{heldCount === 1 ? ' is' : 's are'} on billing hold</span> — these are excluded from this run.
              </span>
            </div>
          ) : null;
        })()}

        <div className="max-h-[50vh] overflow-y-auto space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading preview...</p>
          ) : totalJobCount === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No completed jobs are waiting to be billed for this template right now.</p>
          ) : (
            groups.map(group => (
              <div key={group.customerId} className="rounded-lg border">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2 border-b">
                  <span className="text-sm font-medium">{group.customerName}</span>
                  <span className="text-sm text-muted-foreground">
                    ${group.jobs.filter(j => !excludedJobIds.has(j.id)).reduce((s, j) => s + j.totalAmount, 0).toFixed(2)}
                  </span>
                </div>
                <div className="divide-y">
                  {group.jobs.map(job => {
                    const excluded = excludedJobIds.has(job.id);
                    const isDuplicate = job.flags?.duplicate;
                    const isOutlier = job.flags?.outlier;
                    const isFlagged = isDuplicate || isOutlier;
                    const flagTooltip = [
                      isDuplicate ? 'Possible duplicate — another job for this service was completed within 30 minutes' : '',
                      isOutlier ? 'Unusual amount — this job\'s total is well outside the typical range for this customer' : '',
                    ].filter(Boolean).join('\n');
                    const held = job.holdFromBilling ?? false;
                    const isPending = pendingHolds.has(job.id);
                    return (
                      <div
                        key={job.id}
                        className={`flex items-center gap-3 px-3 py-2 text-sm ${excluded ? 'opacity-50' : ''} ${isFlagged && !excluded ? 'bg-amber-50/60' : ''}`}
                      >
                        <label className="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
                          <input
                            type="checkbox"
                            title={excluded ? 'Include this job in the billing run' : 'Exclude this job from the billing run'}
                            className="h-4 w-4 rounded border-input shrink-0"
                            checked={!excluded}
                            onChange={() => toggleJob(job.id)}
                          />
                          <span className="flex-1 truncate">{job.title}</span>
                          {isFlagged && (
                            <span title={flagTooltip} className="flex items-center gap-1 text-amber-600 shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span className="text-xs font-medium">
                                {isDuplicate && isOutlier ? 'Duplicate · Outlier' : isDuplicate ? 'Duplicate' : 'Outlier'}
                              </span>
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(job.completedAt), 'MMM d, yyyy')}
                          </span>
                          <span className="w-20 text-right font-medium">${job.totalAmount.toFixed(2)}</span>
                        </label>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => toggleHold(job.id, held)}
                          title={held ? 'This job is held from the overnight billing run — click to release' : 'Hold this job out of the automatic overnight billing run'}
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                            held
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          } disabled:opacity-50`}
                        >
                          {isPending ? '…' : held ? 'Held' : 'Hold'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {totalJobCount > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm font-semibold">
            <span>{includedJobCount} of {totalJobCount} job{totalJobCount === 1 ? '' : 's'} included</span>
            <span>Total: ${includedTotal.toFixed(2)}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" title="Close the billing preview without generating invoices" onClick={onClose}>Cancel</Button>
          <Button
            title="Create invoices from the selected completed jobs"
            onClick={() => onGenerate([...excludedJobIds])}
            disabled={isGenerating || isLoading || includedJobCount === 0}
          >
            {isGenerating ? 'Generating...' : `Generate Invoice${groups.length > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceSort, setInvoiceSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'createdAt', dir: 'desc' });
  const [customerIdFilter, setCustomerIdFilter] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('');
  const [invoiceDateFrom, setInvoiceDateFrom] = useState('');
  const [invoiceDateTo, setInvoiceDateTo] = useState('');
  const [partsExpanded, setPartsExpanded] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [templateNextRunFrom, setTemplateNextRunFrom] = useState('');
  const [templateNextRunTo, setTemplateNextRunTo] = useState('');
  const [templateBillingModeFilter, setTemplateBillingModeFilter] = useState('');
  const [, setLocation] = useLocation();
  const [financialsTab, setFinancialsTab] = useState('invoices');

  // Open new-invoice sheet when arriving via quick-add shortcut (?action=create)
  // Or open a specific invoice when arriving via ?invoiceId=N
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      setCreateInvoiceOpen(true);
      // Pre-fill customerId if provided via ?customerId=N
      const cid = params.get('customerId');
      if (cid) setTimeout(() => document.dispatchEvent(new CustomEvent('financials:prefillCustomer', { detail: cid })), 50);
      window.history.replaceState({}, '', window.location.pathname);
    }
    const invId = params.get('invoiceId');
    if (invId) {
      setSelectedInvoiceId(Number(invId));
      setFinancialsTab('invoices');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const cidFilter = params.get('customerIdFilter');
    if (cidFilter) {
      setCustomerIdFilter(cidFilter);
      setFinancialsTab('invoices');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [editingTemplate, setEditingTemplate] = useState<RecurringInvoiceTemplate | null>(null);
  const [approvingFlag, setApprovingFlag] = useState<StopServiceFlag | null>(null);
  const [resumingFlag, setResumingFlag] = useState<StopServiceFlag | null>(null);
  const [approvingCancelReq, setApprovingCancelReq] = useState<PlanCancelRequest | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<{ id: number; name: string } | null>(null);
  const [flagSearch, setFlagSearch] = useState('');
  const [flagDateRange, setFlagDateRange] = useState('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [addLineItemOpen, setAddLineItemOpen] = useState(false);
  const [newLineItemDesc, setNewLineItemDesc] = useState('');
  const [newLineItemQty, setNewLineItemQty] = useState('1');
  const [newLineItemPrice, setNewLineItemPrice] = useState('');

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
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  const { data: stopServiceFlags, isLoading: flagsLoading } = useListStopServiceFlags(
    { status: 'pending' },
    { query: { queryKey: getListStopServiceFlagsQueryKey({ status: 'pending' }) } },
  );

  const { data: dismissedFlags } = useListStopServiceFlags(
    { status: 'dismissed' },
    { query: { enabled: showDismissed, queryKey: getListStopServiceFlagsQueryKey({ status: 'dismissed' }) } },
  );

  const { data: cancelRequests, isLoading: cancelReqsLoading } = useListPlanCancelRequests(
    { status: 'pending' },
    { query: { queryKey: getListPlanCancelRequestsQueryKey({ status: 'pending' }) } },
  );

  const { data: dismissedCancelReqs } = useListPlanCancelRequests(
    { status: 'dismissed' },
    { query: { enabled: showDismissed, queryKey: getListPlanCancelRequestsQueryKey({ status: 'dismissed' }) } },
  );

  const approveCancelReq = useApprovePlanCancelRequest();
  const dismissCancelReq = useDismissPlanCancelRequest();

  const allFlags = [
    ...(stopServiceFlags ?? []),
    ...(showDismissed ? (dismissedFlags ?? []) : []),
  ];

  const filteredFlags = allFlags.filter(flag => {
    if (flagSearch && !(flag.customerName ?? '').toLowerCase().includes(flagSearch.toLowerCase())) return false;
    if (flagDateRange !== 'all') {
      const days = parseInt(flagDateRange, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      if (new Date(flag.createdAt) < cutoff) return false;
    }
    return true;
  });

  const approveFlag = useApproveStopServiceFlag();
  const dismissFlag = useDismissStopServiceFlag();
  const resumePlan = useResumeStopServiceFlagPlan();

  const handleApproveFlag = (flag: StopServiceFlag) => {
    approveFlag.mutate(
      { id: flag.id },
      {
        onSuccess: () => {
          toast.success(`Service paused for ${flag.customerName ?? 'customer'}`);
          qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey({ status: 'pending' }) });
          setApprovingFlag(null);
        },
        onError: () => toast.error('Failed to approve flag'),
      },
    );
  };

  const handleDismissFlag = (flag: StopServiceFlag) => {
    dismissFlag.mutate(
      { id: flag.id },
      {
        onSuccess: () => {
          toast.success('Flag dismissed');
          qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey({ status: 'pending' }) });
        },
        onError: () => toast.error('Failed to dismiss flag'),
      },
    );
  };

  const handleResumePlan = (flag: StopServiceFlag) => {
    resumePlan.mutate(
      { id: flag.id },
      {
        onSuccess: () => {
          toast.success(`Plan resumed for ${flag.customerName ?? 'customer'}`);
          qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey({ status: 'pending' }) });
          setResumingFlag(null);
        },
        onError: () => toast.error('Failed to resume plan'),
      },
    );
  };

  const updateInvoice = useUpdateInvoice();
  const deleteTemplate = useDeleteRecurringTemplate();
  const runNow = useRunRecurringTemplateNow();
  const patchTemplate = useUpdateRecurringTemplate();
  const retryEmail = useRetryBillingEmail();
  const printMailInvoice = usePrintMailInvoice({
    mutation: {
      onSuccess: () => {
        toast.success('Invoice mailed via Lob');
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        if (selectedInvoiceId) qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(selectedInvoiceId) });
      },
      onError: (err: any) => toast.error(err?.error ?? 'Failed to mail invoice'),
    },
  });

  const markPaid = useUpdateInvoice({
    mutation: {
      onSuccess: () => {
        toast.success('Invoice marked as paid');
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      },
      onError: () => toast.error('Failed to mark invoice as paid'),
    },
  });
  const sendReminder = useSendInvoiceReminder({
    mutation: {
      onSuccess: (data) => {
        if (data.delivered) {
          toast.success(data.message ?? 'Reminder sent');
        } else {
          toast.warning(data.message ?? 'Reminder could not be delivered — check provider settings');
        }
        if (selectedInvoiceId) qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(selectedInvoiceId) });
      },
      onError: (err: any) => toast.error(err?.error ?? 'Failed to send reminder'),
    },
  });

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

  const [deleteTemplateId, setDeleteTemplateId] = useState<{ id: number; name: string } | null>(null);
  const [invoiceNotesEditing, setInvoiceNotesEditing] = useState(false);
  const [invoiceNotesVal, setInvoiceNotesVal] = useState('');
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidMethod, setMarkPaidMethod] = useState('check');
  const [markPaidAmount, setMarkPaidAmount] = useState('');
  const [markPaidDate, setMarkPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    if (selectedInvoice) { setInvoiceNotesVal(selectedInvoice.notes ?? ''); setInvoiceNotesEditing(false); }
  }, [selectedInvoice?.id]);

  const handleDeleteTemplate = (id: number, name: string) => {
    setDeleteTemplateId({ id, name });
  };

  const handleRunNow = (id: number, excludeJobIds?: number[]) => {
    runNow.mutate({ id, data: excludeJobIds && excludeJobIds.length > 0 ? { excludeJobIds } : undefined }, {
      onSuccess: (data) => {
        const invoiceIds = (data as { invoiceIds: number[] }).invoiceIds ?? [];
        toast.success(
          invoiceIds.length > 1
            ? `${invoiceIds.length} invoices generated`
            : `Invoice #${invoiceIds[0]} generated`,
        );
        qc.invalidateQueries({ queryKey: getGetBillingAutomationStatusQueryKey() });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
        setPreviewTemplate(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to generate invoice'),
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
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="invoices"
            entityLabel="Invoices"
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() })}
          />
          <Button className="gap-2" title="Create a new invoice" onClick={() => setCreateInvoiceOpen(true)}><Plus className="w-4 h-4" /> Create Invoice</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
        {(() => {
          const draftInvoices = (invoices ?? []).filter(inv => inv.status === 'draft');
          const draftTotal = draftInvoices.reduce((s, inv) => s + inv.total, 0);
          const activeStaticTemplates = (templates ?? []).filter((t: any) => t.status === 'active' && t.billingMode !== 'completed_work');
          const mrrValue = activeStaticTemplates.reduce((sum: number, t: any) => {
            const li: { quantity: number; unitPrice: number }[] = Array.isArray(t.lineItems) ? t.lineItems : [];
            const subtotal = li.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
            if (t.cycle === 'weekly') return sum + subtotal * 4;
            if (t.cycle === 'biweekly') return sum + subtotal * 2;
            if (t.cycle === 'monthly') return sum + subtotal;
            if (t.cycle === 'quarterly') return sum + subtotal / 3;
            if (t.cycle === 'annually') return sum + subtotal / 12;
            return sum + subtotal;
          }, 0);
          return [
            { label: 'Total Revenue',    value: summary?.totalRevenue,         icon: DollarSign,   color: 'text-primary bg-primary/10' },
            { label: 'Outstanding',      value: summary?.totalOutstanding,      icon: Clock,        color: 'text-amber-500 bg-amber-500/10' },
            { label: 'Overdue',          value: summary?.totalOverdue,          icon: ArrowUpRight, color: 'text-destructive bg-destructive/10', destructive: true },
            { label: 'Paid This Month',  value: summary?.paidThisMonth,         icon: CheckCircle,  color: 'text-emerald-500 bg-emerald-500/10' },
            { label: 'Draft',            value: draftTotal,                     icon: FileText,     color: 'text-muted-foreground bg-muted' },
            { label: 'Avg Invoice',      value: summary?.averageInvoiceValue,   icon: DollarSign,   color: 'text-violet-500 bg-violet-500/10' },
            { label: 'MRR (Recurring)',  value: mrrValue,                       icon: RefreshCw,    color: 'text-indigo-500 bg-indigo-500/10' },
          ];
        })().map(({ label, value, icon: Icon, color, destructive }) => {
          const filterStatus = label === 'Overdue' ? 'overdue' : label === 'Outstanding' ? 'sent' : label === 'Draft' ? 'draft' : label === 'Paid This Month' ? 'paid' : null;
          return (
          <Card key={label} className={filterStatus ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} title={filterStatus ? 'Click to filter invoices' : undefined} onClick={filterStatus ? () => { setFinancialsTab('invoices'); setInvoiceStatusFilter(filterStatus); } : undefined}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className={`text-sm font-medium ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>{label}</p>
                  <p className={`text-3xl font-bold mt-1 ${destructive ? 'text-destructive' : ''}`} title={`${label}: $${(value ?? 0).toLocaleString()}`}>
                    ${(value ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className={`p-2 rounded-lg ${color}`}><Icon className="w-5 h-5" /></div>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      {/* Tabs */}
      <Tabs value={financialsTab} onValueChange={setFinancialsTab}>
        <TabsList>
          <TabsTrigger value="invoices" title="View all invoices">
            <FileText className="w-4 h-4 mr-2" />All Invoices
            {(() => { const n = (invoices ?? []).filter(inv => inv.status === 'overdue').length; return n > 0 ? <Badge className="ml-2 h-4 px-1 text-[10px] bg-red-500 text-white border-transparent">{n}</Badge> : null; })()}
            {(() => { const n = (invoices ?? []).filter(inv => inv.status === 'draft').length; return n > 0 ? <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{n} draft</Badge> : null; })()}
          </TabsTrigger>
          <TabsTrigger value="recurring" title="Manage recurring billing templates">
            <RefreshCw className="w-4 h-4 mr-2" />Recurring Billing
            {(() => { const n = (templates ?? []).filter((t: any) => t.status === 'active').length; return n > 0 ? <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">{n}</Badge> : null; })()}
          </TabsTrigger>
          <TabsTrigger value="automation" title="Configure automated billing email reminders">
            <Mail className="w-4 h-4 mr-2" />Billing Automation
            {(queueStats.pending > 0 || queueStats.failed > 0) && (
              <Badge className="ml-2 h-4 px-1 text-[10px] bg-amber-500 text-white border-transparent">
                {queueStats.pending + queueStats.failed}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approvals" title="Review pending service stop and cancellation requests">
            <ShieldAlert className="w-4 h-4 mr-2" />Approvals
            {((stopServiceFlags?.length ?? 0) + (cancelRequests?.length ?? 0)) > 0 && (
              <Badge className="ml-2 h-4 px-1 text-[10px] bg-red-500 text-white border-transparent" title="Pending service stops and cancellations requiring review">
                {(stopServiceFlags?.length ?? 0) + (cancelRequests?.length ?? 0)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="vendors" title="Track vendor invoices and expenses"><Building2 className="w-4 h-4 mr-2" />Vendors & Expenses</TabsTrigger>
        </TabsList>

        {/* ── All Invoices ── */}
        <TabsContent value="invoices">
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> All Invoices</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={invoiceStatusFilter ?? 'all'} onValueChange={v => setInvoiceStatusFilter(v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-8 text-sm w-36" title="Filter invoices by status"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <input
                    type="date"
                    value={invoiceDateFrom}
                    onChange={e => setInvoiceDateFrom(e.target.value)}
                    className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36"
                    title="Issue date from"
                  />
                  <input
                    type="date"
                    value={invoiceDateTo}
                    onChange={e => setInvoiceDateTo(e.target.value)}
                    className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36"
                    title="Issue date to"
                  />
                  {customerIdFilter ? (
                    <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded px-2 h-8" title={`Filtering by customer: ${(customers as any)?.items?.find((c: any) => String(c.id) === customerIdFilter)?.name ?? 'Customer'}`}>
                      {(customers as any)?.items?.find((c: any) => String(c.id) === customerIdFilter)?.name ?? 'Customer'}
                      <button className="ml-1 opacity-70 hover:opacity-100" title="Clear customer filter" onClick={() => setCustomerIdFilter('')}>×</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        value={invoiceSearch}
                        onChange={e => { setInvoiceSearch(e.target.value); setCustomerIdFilter(''); }}
                        placeholder="Customer / #…"
                        title="Search by customer name or invoice number"
                        className="h-8 text-sm w-36"
                      />
                      {invoiceSearch && <button onClick={() => setInvoiceSearch('')} title="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
                    </div>
                  )}
                  <ImportExportControls
                    entity="invoices"
                    entityLabel="Invoices"
                    exportQuery={{
                      ...(invoiceStatusFilter !== 'all' ? { status: invoiceStatusFilter } : {}),
                      ...(invoiceDateFrom ? { dateFrom: invoiceDateFrom } : {}),
                      ...(invoiceDateTo ? { dateTo: invoiceDateTo } : {}),
                      ...(invoiceSearch ? { q: invoiceSearch } : {}),
                    }}
                    onImportComplete={() => qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() })}
                  />
                </div>
              </div>
              {!isLoading && (invoiceStatusFilter || invoiceSearch.trim() || invoiceDateFrom || invoiceDateTo || customerIdFilter) && (() => {
                const n = (invoices ?? [])
                  .filter(inv => !invoiceStatusFilter || inv.status === invoiceStatusFilter)
                  .filter(inv => !invoiceDateFrom || new Date(inv.createdAt) >= new Date(invoiceDateFrom))
                  .filter(inv => !invoiceDateTo || new Date(inv.createdAt) <= new Date(invoiceDateTo + 'T23:59:59'))
                  .filter(inv => { if (!invoiceSearch.trim()) return true; const q = invoiceSearch.trim().replace(/^#/, '').toLowerCase(); return (inv.invoiceNumber ?? '').toLowerCase().includes(q) || (inv.customerName ?? '').toLowerCase().includes(q); })
                  .filter(inv => !customerIdFilter || String((inv as any).customerId) === customerIdFilter).length;
                return <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/20">Showing {n} of {(invoices ?? []).length} invoice{(invoices ?? []).length !== 1 ? 's' : ''}</div>;
              })()}
              <Table>
                <TableHeader>
                  <TableRow>
                    {(['invoiceNumber', 'customerName', 'status', 'createdAt', 'dueDate', 'amount'] as const).map((col, i) => {
                      const labels: Record<string, string> = { invoiceNumber: 'Invoice', customerName: 'Customer', status: 'Status', createdAt: 'Issued', dueDate: 'Due / Paid', amount: 'Amount' };
                      const isActive = (invoiceSort as any)?.col === col;
                      return (
                        <TableHead key={col} title={`Sort by ${labels[col]}`} className={i === 5 ? 'text-right cursor-pointer select-none' : 'cursor-pointer select-none'} onClick={() => setInvoiceSort((s: any) => ({ col, dir: s?.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                          <span className="flex items-center gap-1">{i === 5 ? <span className="ml-auto flex items-center gap-1">{labels[col]}{isActive ? ((invoiceSort as any).dir === 'asc' ? ' ↑' : ' ↓') : ''}</span> : <>{labels[col]}{isActive ? ((invoiceSort as any).dir === 'asc' ? ' ↑' : ' ↓') : ''}</>}</span>
                        </TableHead>
                      );
                    })}
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading invoices...</TableCell></TableRow>
                  ) : invoices?.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
                  ) : (
                    (() => {
                      const filtered = (invoices ?? [])
                        .filter(inv => !invoiceStatusFilter || inv.status === invoiceStatusFilter)
                        .filter(inv => !invoiceDateFrom || new Date(inv.createdAt) >= new Date(invoiceDateFrom))
                        .filter(inv => !invoiceDateTo || new Date(inv.createdAt) <= new Date(invoiceDateTo + 'T23:59:59'))
                        .filter(inv => {
                          if (!invoiceSearch.trim()) return true;
                          const q = invoiceSearch.trim().replace(/^#/, '').toLowerCase();
                          return (inv.invoiceNumber ?? '').toLowerCase().includes(q) ||
                            (inv.customerName ?? '').toLowerCase().includes(q);
                        })
                        .filter(inv => !customerIdFilter || String((inv as any).customerId) === customerIdFilter);
                      const { col, dir } = (invoiceSort as any) ?? { col: 'createdAt', dir: 'desc' };
                      const sorted = [...filtered].sort((a, b) => {
                        const av = col === 'amount' ? (a as any).totalAmount ?? 0 : col === 'dueDate' ? ((a as any).dueDate ?? '') : col === 'customerName' ? (a.customerName ?? '') : col === 'status' ? a.status : col === 'createdAt' ? a.createdAt : (a.invoiceNumber ?? '');
                        const bv = col === 'amount' ? (b as any).totalAmount ?? 0 : col === 'dueDate' ? ((b as any).dueDate ?? '') : col === 'customerName' ? (b.customerName ?? '') : col === 'status' ? b.status : col === 'createdAt' ? b.createdAt : (b.invoiceNumber ?? '');
                        return dir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
                      });
                      return sorted.map(invoice => (
                      <TableRow key={invoice.id} className="cursor-pointer hover:bg-muted/50 group" onClick={() => setSelectedInvoiceId(invoice.id)}>
                        <TableCell className="font-medium font-mono text-sm" title={`Invoice ${invoice.invoiceNumber}`}>{invoice.invoiceNumber}</TableCell>
                        <TableCell>
                          <div>
                            {(invoice as any).customerId ? (
                              <span
                                className="text-primary hover:underline cursor-pointer"
                                title={invoice.customerName ?? undefined}
                                onClick={e => { e.stopPropagation(); setLocation(`/customers/${(invoice as any).customerId}`); }}
                              >
                                {invoice.customerName}
                              </span>
                            ) : invoice.customerName}
                            {(invoice as any).propertyAddress && <p className="text-xs text-muted-foreground truncate max-w-[180px]" title={(invoice as any).propertyAddress}>{(invoice as any).propertyAddress}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[invoice.status] ?? ''} variant="outline" title={`Invoice status: ${invoice.status}`}>
                            {invoice.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm" title={format(new Date(invoice.createdAt), 'MMM d, yyyy h:mm a')}>
                          {(() => {
                            const daysAgo = Math.floor((Date.now() - new Date(invoice.createdAt).getTime()) / 86400000);
                            if (daysAgo === 0) return 'Today';
                            if (daysAgo === 1) return 'Yesterday';
                            if (daysAgo <= 14) return `${daysAgo}d ago`;
                            return format(new Date(invoice.createdAt), 'MMM d, yyyy');
                          })()}
                        </TableCell>
                        <TableCell className={`text-sm ${(invoice as any).dueDate && invoice.status !== 'paid' && new Date((invoice as any).dueDate) < new Date() ? 'text-destructive font-medium' : 'text-muted-foreground'}`} title={(invoice as any).dueDate ? `Due: ${format(new Date((invoice as any).dueDate), 'EEEE, MMMM d, yyyy')}` : undefined}>
                          {invoice.status === 'paid' && (invoice as any).paidAt
                            ? <span className="text-emerald-700">Paid {format(new Date((invoice as any).paidAt), 'MMM d')}</span>
                            : (invoice as any).dueDate ? format(new Date((invoice as any).dueDate), 'MMM d') : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium" title={`Invoice total: $${invoice.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}>
                          <div className="flex flex-col items-end gap-0.5">
                            <span>${invoice.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            {(invoice as any).recurringTemplateId && <span className="text-[10px] text-violet-600 font-normal leading-none" title="Generated by a recurring billing template">recurring</span>}
                          </div>
                        </TableCell>
                        <TableCell className="w-20 p-1">
                          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1.5 rounded hover:bg-muted disabled:opacity-40"
                                title={sendReminder.isPending ? 'Sending…' : 'Send payment reminder'}
                                disabled={sendReminder.isPending || markPaid.isPending}
                                onClick={e => { e.stopPropagation(); sendReminder.mutate({ id: invoice.id }); }}
                              >
                                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                              <button
                                className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 disabled:opacity-40"
                                title={markPaid.isPending ? 'Marking paid…' : 'Mark as paid'}
                                disabled={sendReminder.isPending || markPaid.isPending}
                                onClick={e => { e.stopPropagation(); markPaid.mutate({ id: invoice.id, data: { status: 'paid' } }); }}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                    })()
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Recurring Billing ── */}
        <TabsContent value="recurring" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold flex items-center gap-2">Recurring Invoice Templates {templates && templates.length > 0 && <Badge variant="secondary" className="text-xs font-normal">{templates.length}</Badge>}</h3>
              <p className="text-sm text-muted-foreground">Automatically generate invoices on a fixed schedule for contracted clients.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={templateNextRunFrom}
                onChange={e => setTemplateNextRunFrom(e.target.value)}
                className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
                title="Next run from"
              />
              <span className="text-sm text-muted-foreground">–</span>
              <input
                type="date"
                value={templateNextRunTo}
                onChange={e => setTemplateNextRunTo(e.target.value)}
                className="h-9 text-sm px-2.5 rounded-md border border-input bg-background"
                title="Next run to"
              />
              {(templateNextRunFrom || templateNextRunTo) && (
                <Button variant="ghost" size="sm" title="Clear next run date filters" className="text-xs" onClick={() => { setTemplateNextRunFrom(''); setTemplateNextRunTo(''); }}>Clear</Button>
              )}
              <Select value={templateBillingModeFilter || '__all__'} onValueChange={v => setTemplateBillingModeFilter(v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-44 h-9 text-sm" title="Filter by billing mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All billing modes</SelectItem>
                  <SelectItem value="static">Static</SelectItem>
                  <SelectItem value="completed_work">Completed Work</SelectItem>
                </SelectContent>
              </Select>
              <Button className="gap-2" title="Create a new recurring billing template" onClick={() => { setEditingTemplate(null); setTemplateSheetOpen(true); }}>
                <Plus className="w-4 h-4" /> New Template
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Next Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Monthly Value</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templatesLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading templates...</TableCell></TableRow>
                  ) : (templates ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No recurring templates.{' '}<button title="Open the form to create a recurring billing template" className="underline text-primary hover:opacity-80" onClick={() => { setEditingTemplate(null); setTemplateSheetOpen(true); }}>Create one</button>{' '}to automate billing.</TableCell></TableRow>
                  ) : (
                    (templates ?? []).filter(t => !templateNextRunFrom || !t.nextBillingDate || t.nextBillingDate >= templateNextRunFrom).filter(t => !templateNextRunTo || !t.nextBillingDate || t.nextBillingDate <= templateNextRunTo).filter(t => !templateBillingModeFilter || t.billingMode === templateBillingModeFilter).map(t => {
                      const lineItems = (t.lineItems ?? []) as Array<{ quantity: number; unitPrice: number }>;
                      const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
                      const isCompletedWork = t.billingMode === 'completed_work';
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium truncate max-w-[160px]" title={t.name}>{t.name}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            <span title={t.customerName ?? undefined}>{t.customerName ?? (t.serviceName ? null : '—')}</span>
                            {t.customerName && t.serviceName && ' · '}
                            <span title={t.serviceName ?? undefined}>{t.serviceName}</span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={isCompletedWork
                                ? 'bg-blue-100 text-blue-800 border-transparent'
                                : 'bg-slate-100 text-slate-600 border-transparent'}
                              variant="outline"
                              title={isCompletedWork ? 'Billed from completed jobs' : 'Fixed monthly billing amount'}
                            >
                              {isCompletedWork ? 'Completed Work' : 'Static'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground capitalize" title={t.billingCycleType !== 'daily' ? `Billing cycle: ${t.billingCycleType}, day ${t.billingCycleDay}` : `Billing cycle: ${t.billingCycleType}`}>
                            {t.billingCycleType}{t.billingCycleType !== 'daily' ? ` · day ${t.billingCycleDay}` : ''}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(t as any).lastGeneratedAt
                              ? (() => {
                                  const d = new Date((t as any).lastGeneratedAt);
                                  const daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
                                  const label = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
                                  return <div className="flex items-center gap-1.5" title={d.toLocaleDateString()}><Clock className="w-3.5 h-3.5" />{label}</div>;
                                })()
                              : <span>—</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                              <span title={t.nextBillingDate ? new Date(t.nextBillingDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : undefined}>{t.nextBillingDate}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <button
                              title={t.isActive ? 'Click to pause' : 'Click to resume'}
                              onClick={() => { patchTemplate.mutate({ id: t.id, data: { isActive: !t.isActive } }, { onSuccess: () => { toast.success(t.isActive ? 'Template paused' : 'Template resumed'); qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() }); }, onError: () => toast.error('Failed to update template') }); }}
                              className="focus:outline-none"
                            >
                              <Badge
                                className={t.isActive
                                  ? 'bg-emerald-100 text-emerald-800 border-transparent hover:bg-emerald-200 cursor-pointer'
                                  : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200 cursor-pointer'}
                                variant="outline"
                                title={t.isActive ? 'Click to pause this template' : 'Click to resume this template'}
                              >
                                {patchTemplate.isPending ? '…' : t.isActive ? 'Active' : 'Paused'}
                              </Badge>
                            </button>
                          </TableCell>
                          <TableCell className="text-right font-medium" title={isCompletedWork ? 'Completed-work plan — billed from completed jobs' : `Monthly subtotal: $${subtotal.toFixed(2)}`}>{isCompletedWork ? '—' : `${subtotal.toFixed(2)}`}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isCompletedWork ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                                  title="Preview jobs to be billed"
                                  onClick={() => setPreviewTemplate({ id: t.id, name: t.name })}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                                  title={runNow.isPending ? 'Generating…' : 'Generate now'}
                                  onClick={() => handleRunNow(t.id)}
                                  disabled={runNow.isPending}
                                >
                                  {runNow.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                </Button>
                              )}
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
                          <TableCell className="font-mono text-sm font-medium" title={`Invoice ${inv.invoiceNumber}`}>{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-muted-foreground" title={inv.customerName ?? undefined}>{inv.customerName}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[inv.status] ?? ''} variant="outline" title={`Invoice status: ${inv.status}`}>{inv.status.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground" title={format(new Date(inv.createdAt), 'h:mm a')}>{format(new Date(inv.createdAt), 'h:mm a')}</TableCell>
                          <TableCell className="text-right font-medium" title={`Invoice total: $${inv.total.toFixed(2)}`}>${inv.total.toFixed(2)}</TableCell>
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
                          <TableCell className="font-mono text-sm cursor-pointer hover:underline text-primary" title={`View invoice ${entry.invoiceNumber ?? `#${entry.invoiceId}`}`} onClick={() => setSelectedInvoiceId(entry.invoiceId)}>{entry.invoiceNumber ?? `#${entry.invoiceId}`}</TableCell>
                          <TableCell>
                            <Badge className={EMAIL_STATUS_COLORS[entry.status] ?? ''} variant="outline" title={`Email status: ${entry.status}`}>
                              {entry.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm" title={`${entry.attempts} delivery attempt${entry.attempts !== 1 ? 's' : ''}`}>{entry.attempts}</TableCell>
                          <TableCell className="text-sm text-muted-foreground" title={entry.lastAttemptAt ? format(new Date(entry.lastAttemptAt), 'EEEE, MMMM d, yyyy h:mm a') : undefined}>
                            {entry.lastAttemptAt ? format(new Date(entry.lastAttemptAt), 'MMM d, h:mm a') : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-destructive truncate max-w-[200px]" title={entry.errorMsg ?? undefined}>{entry.errorMsg ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            {entry.status === 'failed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                title="Retry sending this invoice email"
                                className="h-7 text-xs gap-1"
                                onClick={() => handleRetryEmail(entry.id)}
                                disabled={retryEmail.isPending}
                              >
                                <RefreshCw className={`w-3 h-3 ${retryEmail.isPending ? 'animate-spin' : ''}`} /> {retryEmail.isPending ? 'Retrying…' : 'Retry'}
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

        {/* ── Approvals ── */}
        <TabsContent value="approvals" className="space-y-6">
          {/* ── Plan Cancellation Requests ── */}
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold">Plan Cancellation Requests</h3>
              <p className="text-sm text-muted-foreground">Customers who requested to cancel their service plan. Approving will cancel the plan immediately.</p>
            </div>
            {cancelReqsLoading ? (
              <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>
            ) : ((cancelRequests?.length ?? 0) + (showDismissed ? (dismissedCancelReqs?.length ?? 0) : 0)) === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No pending cancellation requests.</p>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...(cancelRequests ?? []), ...(showDismissed ? (dismissedCancelReqs ?? []) : [])].map(req => {
                        const isDismissed = req.status === 'dismissed';
                        return (
                          <TableRow key={req.id} className={isDismissed ? 'opacity-60' : ''}>
                            <TableCell className="font-medium">{(req as any).customerId ? <button className="hover:underline text-primary" title={`View ${req.customerName}`} onClick={() => setLocation(`/customers/${(req as any).customerId}`)}>{req.customerName}</button> : (req.customerName ?? '—')}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{(req as any).planId ? <button className="hover:underline text-primary text-sm" title={`View ${req.planName ?? `Plan #${(req as any).planId}`}`} onClick={() => setLocation(`/plans/${(req as any).planId}`)}>{req.planName ?? `Plan #${(req as any).planId}`}</button> : (req.planName ?? '—')}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={req.reason ?? undefined}>{req.reason ?? <span className="italic">No reason given</span>}</TableCell>
                            <TableCell className="text-sm text-muted-foreground" title={format(new Date(req.createdAt), 'EEEE, MMMM d, yyyy')}>{format(new Date(req.createdAt), 'MMM d, yyyy')}</TableCell>
                            <TableCell>
                              {isDismissed ? (
                                <Badge className="bg-slate-100 text-slate-600 border-transparent" variant="outline">Dismissed</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-800 border-transparent" variant="outline">Pending</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {canManageOffice && !isDismissed && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                    title="Approve this cancellation request"
                                    onClick={() => setApprovingCancelReq(req)}
                                    disabled={approveCancelReq.isPending}
                                  >
                                    <Check className="w-3 h-3" /> {approveCancelReq.isPending ? 'Approving…' : 'Approve'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                                    title="Dismiss this cancellation request without actioning"
                                    onClick={() => {
                                      dismissCancelReq.mutate(
                                        { id: req.id },
                                        {
                                          onSuccess: () => {
                                            toast.success('Request dismissed');
                                            qc.invalidateQueries({ queryKey: getListPlanCancelRequestsQueryKey({ status: 'pending' }) });
                                          },
                                          onError: () => toast.error('Failed to dismiss request'),
                                        },
                                      );
                                    }}
                                    disabled={dismissCancelReq.isPending}
                                  >
                                    <X className="w-3 h-3" /> {dismissCancelReq.isPending ? 'Dismissing…' : 'Dismiss'}
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Stop-Service Approvals ── */}
          <div className="space-y-3">
          <div>
            <h3 className="font-semibold">Stop-Service Approvals</h3>
            <p className="text-sm text-muted-foreground">Review overdue accounts flagged for service pause. Approving will halt the customer's recurring billing series.</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                title="Filter stop-service flags by customer name"
                className="pl-8 h-8 text-sm"
                placeholder="Search customer…"
                value={flagSearch}
                onChange={e => setFlagSearch(e.target.value)}
              />
            </div>
            <Select value={flagDateRange} onValueChange={setFlagDateRange}>
              <SelectTrigger title="Filter flags by date range" className="h-8 text-sm w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dates</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Switch title="Toggle to include flags that have already been dismissed" checked={showDismissed} onCheckedChange={setShowDismissed} />
              Show dismissed
            </label>
          </div>

          {flagsLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
          ) : filteredFlags.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {allFlags.length === 0 ? 'No pending approvals.' : 'No flags match the current filters.'}
            </p>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Days Overdue</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Flagged</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFlags.map(flag => {
                      const isDismissed = flag.status === 'dismissed';
                      return (
                        <TableRow key={flag.id} className={isDismissed ? 'opacity-60' : ''}>
                          <TableCell className="font-medium">{(flag as any).customerId ? <button className="hover:underline text-primary" title={`View ${flag.customerName ?? 'customer'}`} onClick={() => setLocation(`/customers/${(flag as any).customerId}`)}>{flag.customerName ?? '—'}</button> : (flag.customerName ?? '—')}</TableCell>
                          <TableCell className="font-mono text-sm cursor-pointer hover:underline text-primary" title={`View invoice ${flag.invoiceNumber ?? `#${flag.invoiceId}`}`} onClick={() => setSelectedInvoiceId(flag.invoiceId)}>{flag.invoiceNumber ?? `#${flag.invoiceId}`}</TableCell>
                          <TableCell>
                            <Badge className="bg-red-100 text-red-800 border-transparent" variant="outline" title={`${flag.daysOverdue} days overdue`}>
                              {flag.daysOverdue}d
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={flag.message}>{flag.message}</TableCell>
                          <TableCell className="text-sm text-muted-foreground" title={format(new Date(flag.createdAt), 'EEEE, MMMM d, yyyy')}>
                            {format(new Date(flag.createdAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            {isDismissed ? (
                              <Badge className="bg-slate-100 text-slate-600 border-transparent" variant="outline">Dismissed</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800 border-transparent" variant="outline">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canManageOffice && !isDismissed && (
                              <div className="flex items-center justify-end gap-1">
                                {flag.planId && flag.planStatus === 'paused' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                                    title="Resume the customer's service plan"
                                    onClick={() => setResumingFlag(flag)}
                                    disabled={resumePlan.isPending}
                                  >
                                    <Play className="w-3 h-3" /> {resumePlan.isPending ? 'Resuming…' : 'Resume plan'}
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                  title="Approve this stop-service flag"
                                  onClick={() => setApprovingFlag(flag)}
                                  disabled={approveFlag.isPending}
                                >
                                  <Check className="w-3 h-3" /> {approveFlag.isPending ? 'Approving…' : 'Approve'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                                  title="Dismiss this flag without actioning"
                                  onClick={() => handleDismissFlag(flag)}
                                  disabled={dismissFlag.isPending}
                                >
                                  <X className="w-3 h-3" /> {dismissFlag.isPending ? 'Dismissing…' : 'Dismiss'}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          </div>{/* end stop-service section */}
        </TabsContent>

        {/* ── Vendors & Expenses ── */}
        <TabsContent value="vendors">
          <VendorExpenseLedger canEdit={canManageOffice} />
        </TabsContent>
      </Tabs>

      {/* Approve Plan Cancellation Request Dialog */}
      <Dialog open={!!approvingCancelReq} onOpenChange={open => { if (!open) setApprovingCancelReq(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this service plan?</DialogTitle>
            <DialogDescription>
              This will immediately cancel the plan for{' '}
              <strong>{approvingCancelReq?.customerName ?? 'this customer'}</strong>
              {approvingCancelReq?.planName ? ` (${approvingCancelReq.planName})` : ''}.
              No further visits or invoices will be generated.
              {approvingCancelReq?.reason && (
                <> Customer's reason: <em>"{approvingCancelReq.reason}"</em></>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" title="Keep the plan active — decline this cancellation request" onClick={() => setApprovingCancelReq(null)}>Keep plan</Button>
            <Button
              variant="destructive"
              title="Approve the cancellation and end this customer's service plan"
              disabled={approveCancelReq.isPending}
              onClick={() => {
                if (!approvingCancelReq) return;
                approveCancelReq.mutate(
                  { id: approvingCancelReq.id },
                  {
                    onSuccess: () => {
                      toast.success(`Plan cancelled for ${approvingCancelReq.customerName ?? 'customer'}`);
                      qc.invalidateQueries({ queryKey: getListPlanCancelRequestsQueryKey({ status: 'pending' }) });
                      setApprovingCancelReq(null);
                    },
                    onError: () => toast.error('Failed to cancel plan'),
                  },
                );
              }}
            >
              {approveCancelReq.isPending ? 'Cancelling…' : 'Cancel plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Stop-Service Flag Dialog */}
      <Dialog open={!!approvingFlag} onOpenChange={open => { if (!open) setApprovingFlag(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause Recurring Service?</DialogTitle>
            <DialogDescription>
              This will pause the recurring billing series for{' '}
              <strong>{approvingFlag?.customerName ?? 'this customer'}</strong>. No further invoices will be generated
              until service is manually resumed. The overdue invoice{' '}
              <strong>{approvingFlag?.invoiceNumber}</strong> ({approvingFlag?.daysOverdue} days overdue) will remain
              outstanding.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" title="Dismiss without pausing service" onClick={() => setApprovingFlag(null)}>Cancel</Button>
            <Button
              variant="destructive"
              title="Approve and pause recurring billing for this customer"
              disabled={approveFlag.isPending}
              onClick={() => approvingFlag && handleApproveFlag(approvingFlag)}
            >
              {approveFlag.isPending ? 'Pausing...' : 'Approve & Pause Service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Plan Dialog */}
      <Dialog open={!!resumingFlag} onOpenChange={open => { if (!open) setResumingFlag(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resume Service Plan?</DialogTitle>
            <DialogDescription>
              This will set the plan for{' '}
              <strong>{resumingFlag?.customerName ?? 'this customer'}</strong> back to{' '}
              <strong>active</strong> and mark this stop-service flag as resolved. Make sure the
              outstanding invoice <strong>{resumingFlag?.invoiceNumber}</strong> has been paid or
              arranged before resuming.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" title="Cancel without resuming service" onClick={() => setResumingFlag(null)}>Cancel</Button>
            <Button
              title="Resume recurring billing and mark this flag as resolved"
              disabled={resumePlan.isPending}
              onClick={() => resumingFlag && handleResumePlan(resumingFlag)}
            >
              {resumePlan.isPending ? 'Resuming...' : 'Resume Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Detail Sheet */}
      <Sheet open={selectedInvoiceId != null} onOpenChange={open => { if (!open) setSelectedInvoiceId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedInvoice ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="font-mono text-xl" title={`Invoice ${selectedInvoice.invoiceNumber}`}>{selectedInvoice.invoiceNumber}</SheetTitle>
                    <SheetDescription className="mt-1" title={format(new Date(selectedInvoice.createdAt), 'EEEE, MMMM d, yyyy h:mm a')}>
                      Created {format(new Date(selectedInvoice.createdAt), 'MMMM d, yyyy')}
                    </SheetDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`${STATUS_COLORS[selectedInvoice.status] ?? ''}`} variant="outline" title={`Invoice status: ${selectedInvoice.status}`}>
                      {selectedInvoice.status.toUpperCase()}
                    </Badge>
                    <Button size="sm" variant="outline" title="Print this invoice" className="gap-1.5 text-xs" onClick={() => printInvoice(selectedInvoice as unknown as Record<string, unknown>, (settings ?? {}) as Record<string, unknown>)}>
                      <Printer className="w-3 h-3" /> Print
                    </Button>
                  </div>
                </div>
              </SheetHeader>

              {/* Business branding */}
              {settings && (settings.companyName || settings.logoUrl || settings.businessTagline || settings.businessPhone || settings.businessEmail || settings.businessWebsite || settings.businessAddress) && (
                <div className="mb-4 p-3 rounded-lg bg-muted/40 border border-border/60 text-center space-y-2">
                  {settings.logoUrl && (
                    <img
                      src={`${import.meta.env.BASE_URL}api/public/tenants/${settings.tenantId}/logo`}
                      alt="Company logo"
                      className="h-10 w-auto mx-auto object-contain"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  {settings.companyName && <p className="font-semibold text-sm">{settings.companyName}</p>}
                  {settings.businessTagline && <p className="text-xs text-muted-foreground italic">{settings.businessTagline}</p>}
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {settings.businessPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{settings.businessPhone}</span>}
                    {settings.businessEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{settings.businessEmail}</span>}
                    {settings.businessWebsite && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{settings.businessWebsite}</span>}
                    {settings.businessAddress && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{settings.businessAddress}</span>}
                  </div>
                </div>
              )}

              <div className="space-y-5">
                {/* Update Status */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Status</label>
                  <div className="flex items-center gap-2">
                    <Select value={selectedInvoice.status} onValueChange={handleStatusChange} disabled={updateInvoice.isPending}>
                      <SelectTrigger className="flex-1" title="Change invoice status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="sent">Sent</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="write_off">Write Off</SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedInvoice.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 shrink-0 text-blue-700 border-blue-300 hover:bg-blue-50"
                        title="Mark this invoice as sent (customer has been notified)"
                        disabled={updateInvoice.isPending}
                        onClick={() => {
                          handleStatusChange('sent');
                          setTimeout(() => {
                            toast('Invoice marked as sent', {
                              description: 'Want to email the invoice link to the customer?',
                              action: { label: 'Send Reminder', onClick: () => { if (selectedInvoiceId) sendReminder.mutate({ id: selectedInvoiceId }); } },
                              duration: 8000,
                            });
                          }, 600);
                        }}
                      >
                        <Send className="w-3.5 h-3.5" /> {updateInvoice.isPending ? 'Updating…' : 'Mark Sent'}
                      </Button>
                    )}
                    {selectedInvoice.status !== 'paid' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 shrink-0 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        title="Record a payment and mark this invoice as paid"
                        disabled={updateInvoice.isPending}
                        onClick={() => setMarkPaidOpen(true)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Paid
                      </Button>
                    )}
                  </div>
                </div>

                {/* View Public Invoice */}
                {(selectedInvoice as any).publicToken && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Customer Invoice Link</p>
                      <p className="text-xs text-muted-foreground">Shareable branded view for the customer</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        title="Copy the customer-facing invoice link to clipboard"
                        onClick={() => {
                          const base = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
                          const url = `${window.location.origin}${base}/invoice/${(selectedInvoice as any).publicToken}`;
                          navigator.clipboard.writeText(url);
                          toast.success('Link copied to clipboard');
                        }}
                      >
                        Copy Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        title="Open the customer-facing invoice in a new tab"
                        onClick={() => {
                          const base = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
                          window.open(`${base}/invoice/${(selectedInvoice as any).publicToken}`, '_blank');
                        }}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resend Invoice Email */}
                {selectedInvoice.status !== 'draft' && selectedInvoice.status !== 'cancelled' && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Email Invoice</p>
                      <p className="text-xs text-muted-foreground">Resend the invoice notification email to the customer</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Resend the invoice notification email to the customer"
                      onClick={async () => {
                        if (!window.confirm(`Resend invoice email to ${selectedInvoice.customerName}?`)) return;
                        try {
                          await customFetch(`/api/invoices/${selectedInvoice.id}/resend-email`, { method: 'POST' });
                          toast.success('Invoice email queued');
                        } catch {
                          toast.error('Failed to send email');
                        }
                      }}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Resend Email
                    </Button>
                  </div>
                )}

                {/* Print & Mail via Lob */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Print & Mail</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedInvoice.lobStatus ? `Mailed — status: ${selectedInvoice.lobStatus}` : 'Send a physical copy of this invoice via Lob'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    title={selectedInvoice.lobLetterId ? 'Physical copy already mailed via Lob' : 'Send a physical copy of this invoice via Lob mail service'}
                    disabled={printMailInvoice.isPending || !!selectedInvoice.lobLetterId}
                    onClick={() => printMailInvoice.mutate({ id: selectedInvoice.id })}
                  >
                    {selectedInvoice.lobLetterId ? 'Mailed' : printMailInvoice.isPending ? 'Sending...' : 'Mail Invoice'}
                  </Button>
                </div>

                {/* Send Payment Reminder */}
                {(() => {
                  const schedule = (settings?.paymentReminderSchedule ?? []) as { offsetDays: number }[];
                  const alreadySent = (selectedInvoice as any).paymentRemindersSent as number[] | null ?? [];
                  const isPaid = selectedInvoice.status === 'paid';
                  const noReminders = !settings?.paymentRemindersEnabled || schedule.length === 0;
                  const allSent = !noReminders && schedule.length > 0 && schedule.every(r => alreadySent.includes(r.offsetDays));
                  const disabledReason = isPaid
                    ? 'Invoice is already paid'
                    : noReminders
                    ? 'Payment reminders are not configured for this account'
                    : allSent
                    ? 'All configured reminders have already been sent'
                    : undefined;
                  const isDisabled = !!disabledReason || sendReminder.isPending;
                  return (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">Payment Reminder</p>
                        <p className="text-xs text-muted-foreground">
                          {allSent
                            ? 'All reminders sent'
                            : `Send next reminder now via ${settings?.paymentReminderChannels?.join(' & ') ?? 'email'}`}
                        </p>
                        {alreadySent.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{alreadySent.length} reminder{alreadySent.length !== 1 ? 's' : ''} sent so far</p>
                        )}
                      </div>
                      <span title={disabledReason}>
                        <Button
                          size="sm"
                          variant="outline"
                          title={!isDisabled ? 'Send a payment reminder email to the customer' : undefined}
                          disabled={isDisabled}
                          onClick={() => sendReminder.mutate({ id: selectedInvoice.id })}
                        >
                          <Mail className="w-3.5 h-3.5 mr-1" />
                          {sendReminder.isPending ? 'Sending...' : 'Send Reminder'}
                        </Button>
                      </span>
                    </div>
                  );
                })()}

                <Separator />

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedInvoice.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <button
                          className="hover:underline text-foreground text-sm"
                          title={`View ${selectedInvoice.customerName}`}
                          onClick={() => { setSelectedInvoiceId(null); setLocation(`/customers/${selectedInvoice.customerId}`); }}
                        >
                          {selectedInvoice.customerName}
                        </button>
                      </div>
                      {(selectedInvoice as any).customerPhone && (
                        <a href={`tel:${(selectedInvoice as any).customerPhone}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5" title={`Call ${(selectedInvoice as any).customerPhone}`}>
                          <Phone className="w-3 h-3" />{(selectedInvoice as any).customerPhone}
                        </a>
                      )}
                      {(selectedInvoice as any).customerEmail && (
                        <a href={`mailto:${(selectedInvoice as any).customerEmail}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5" title={`Email ${(selectedInvoice as any).customerEmail}`}>
                          <Mail className="w-3 h-3" />{(selectedInvoice as any).customerEmail}
                        </a>
                      )}
                    </div>
                  )}
                  {selectedInvoice.jobId && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Job</p>
                      <button
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                        title={`Open job #${selectedInvoice.jobId} in the schedule`}
                        onClick={() => { setSelectedInvoiceId(null); setLocation(`/schedule?jobId=${selectedInvoice.jobId}`); }}
                      >
                        <Briefcase className="w-3.5 h-3.5" /> View Job #{selectedInvoice.jobId}
                      </button>
                    </div>
                  )}
                  {selectedInvoice.dueDate && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Due Date</p>
                      <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /><span title={format(new Date(selectedInvoice.dueDate), 'EEEE, MMMM d, yyyy')}>{format(new Date(selectedInvoice.dueDate), 'MMM d, yyyy')}</span></div>
                    </div>
                  )}
                  {selectedInvoice.paidAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Paid On</p>
                      <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /><span title={format(new Date(selectedInvoice.paidAt), 'EEEE, MMMM d, yyyy')}>{format(new Date(selectedInvoice.paidAt), 'MMM d, yyyy')}</span></div>
                    </div>
                  )}
                </div>

                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Internal Notes</p>
                      {!invoiceNotesEditing && (
                        <Button variant="ghost" size="sm" title="Edit internal staff notes on this invoice" className="h-6 text-xs px-2" onClick={() => setInvoiceNotesEditing(true)}>
                          <Pencil className="w-3 h-3 mr-1" />{selectedInvoice.notes ? 'Edit' : 'Add note'}
                        </Button>
                      )}
                    </div>
                    {invoiceNotesEditing ? (
                      <div className="space-y-2">
                        <Textarea title="Internal notes visible only to staff — not shown on the customer invoice" value={invoiceNotesVal} onChange={e => setInvoiceNotesVal(e.target.value)} placeholder="Staff-only notes…" className="text-sm min-h-[72px]" />
                        <div className="flex gap-2">
                          <Button size="sm" title="Save these internal notes to the invoice" className="h-7 text-xs" disabled={updateInvoice.isPending}
                            onClick={() => {
                              updateInvoice.mutate({ id: selectedInvoice.id, data: { notes: invoiceNotesVal || null } as any }, {
                                onSuccess: () => { setInvoiceNotesEditing(false); toast.success('Notes saved'); },
                              });
                            }}
                          >Save</Button>
                          <Button size="sm" variant="ghost" title="Discard note changes" className="h-7 text-xs" onClick={() => { setInvoiceNotesVal(selectedInvoice.notes ?? ''); setInvoiceNotesEditing(false); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : selectedInvoice.notes ? (
                      <p className="text-sm text-muted-foreground">{selectedInvoice.notes}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No notes yet.</p>
                    )}
                  </div>
                </>

                <Separator />

                {/* Parts used (loaded from linked job) */}
                {selectedInvoice.jobId && jobParts.length > 0 && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      title="Toggle parts used on this job"
                      className="w-full flex items-center justify-between text-left"
                      onClick={() => setPartsExpanded(e => !e)}
                    >
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Parts Used</p>
                        <span className="text-xs font-semibold text-foreground ml-1" title={`Parts total: $${partsTotal.toFixed(2)}`}>${partsTotal.toFixed(2)}</span>
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
                            <span className="font-medium block truncate" title={li.description}>{li.description}</span>
                            <span className="text-xs text-muted-foreground" title={`${li.quantity} × $${li.unitPrice.toFixed(2)} each`}>{li.quantity} × ${li.unitPrice.toFixed(2)}</span>
                          </div>
                          <span className="font-medium ml-4" title={`Line total: $${li.total.toFixed(2)}`}>${li.total.toFixed(2)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-muted-foreground text-center text-xs">No line items</div>
                    )}
                  </div>
                  {canManageOffice && selectedInvoice.status !== 'paid' && selectedInvoice.status !== 'cancelled' && (
                    addLineItemOpen ? (
                      <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                        <input
                          autoFocus
                          className="w-full text-sm border-b border-border bg-transparent py-1 outline-none placeholder:text-muted-foreground"
                          title="Description for the new line item"
                          placeholder="Description"
                          value={newLineItemDesc}
                          onChange={e => setNewLineItemDesc(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="w-16 text-sm border-b border-border bg-transparent py-1 outline-none text-right"
                            title="Number of units"
                            placeholder="Qty"
                            value={newLineItemQty}
                            onChange={e => setNewLineItemQty(e.target.value)}
                          />
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            className="flex-1 text-sm border-b border-border bg-transparent py-1 outline-none text-right"
                            title="Price per unit"
                            placeholder="Unit price"
                            value={newLineItemPrice}
                            onChange={e => setNewLineItemPrice(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button title="Discard this new line item" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAddLineItemOpen(false)}>Cancel</button>
                          <button
                            title="Add this line item to the invoice"
                            className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                            disabled={updateInvoice.isPending}
                            onClick={() => {
                              const qty = parseFloat(newLineItemQty);
                              const price = parseFloat(newLineItemPrice);
                              if (!newLineItemDesc.trim() || Number.isNaN(qty) || Number.isNaN(price)) { toast.error('Fill in all fields'); return; }
                              updateInvoice.mutate({ id: selectedInvoice.id, data: { addLineItem: { description: newLineItemDesc.trim(), quantity: qty, unitPrice: price } } as any }, {
                                onSuccess: () => { toast.success('Line item added'); qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(selectedInvoice.id) }); setAddLineItemOpen(false); setNewLineItemDesc(''); setNewLineItemQty('1'); setNewLineItemPrice(''); },
                                onError: () => toast.error('Failed to add line item'),
                              });
                            }}
                          >{updateInvoice.isPending ? 'Adding…' : 'Add'}</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="w-full text-xs text-muted-foreground hover:text-foreground border border-dashed rounded-lg py-2 flex items-center justify-center gap-1 transition-colors hover:border-foreground/30"
                        title="Add a new line item to this invoice"
                        onClick={() => setAddLineItemOpen(true)}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add line item
                      </button>
                    )
                  )}
                </div>

                {/* Totals */}
                <div className="rounded-lg border divide-y text-sm">
                  <div className="flex justify-between px-3 py-2 text-muted-foreground">
                    <span>Subtotal</span>
                    <span title={`Subtotal (before tax): $${selectedInvoice.subtotal.toFixed(2)}`}>${selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  {((settings as any)?.taxEnabled !== false) && (
                  <div className="flex justify-between px-3 py-2 text-muted-foreground">
                    <span>Tax</span>
                    <span>${selectedInvoice.tax.toFixed(2)}</span>
                  </div>
                  )}
                  <div className="flex justify-between px-3 py-2.5 font-semibold bg-muted/30">
                    <span>Total</span>
                    <span title={`Invoice total: $${selectedInvoice.total.toFixed(2)}`}>${selectedInvoice.total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Invoice footer text */}
                {settings?.invoiceFooterText && (
                  <p className="text-xs text-muted-foreground text-center pt-1">{settings.invoiceFooterText}</p>
                )}
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

      {/* Create Invoice Sheet */}
      <CreateInvoiceSheet
        open={createInvoiceOpen}
        onClose={() => setCreateInvoiceOpen(false)}
        customers={customerOptions}
        invoiceDueDays={(settings as any)?.invoiceDueDays}
      />

      {/* Preview Billing Dialog */}
      <PreviewBillingDialog
        templateId={previewTemplate?.id ?? null}
        templateName={previewTemplate?.name ?? null}
        onClose={() => setPreviewTemplate(null)}
        onGenerate={(excludeJobIds) => { if (previewTemplate) handleRunNow(previewTemplate.id, excludeJobIds); }}
        isGenerating={runNow.isPending}
      />

      {/* Delete Recurring Template Confirmation */}
      <Dialog open={deleteTemplateId != null} onOpenChange={open => { if (!open) setDeleteTemplateId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Recurring Template</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{deleteTemplateId?.name}&rdquo;? This will not cancel already-generated invoices.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" title="Keep this recurring template" onClick={() => setDeleteTemplateId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              title="Permanently delete this recurring billing template"
              disabled={deleteTemplate.isPending}
              onClick={() => {
                if (!deleteTemplateId) return;
                deleteTemplate.mutate({ id: deleteTemplateId.id }, {
                  onSuccess: () => {
                    toast.success('Template deleted');
                    qc.invalidateQueries({ queryKey: getListRecurringTemplatesQueryKey() });
                    setDeleteTemplateId(null);
                  },
                  onError: () => toast.error('Failed to delete template'),
                });
              }}
            >
              {deleteTemplate.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Paid — payment method dialog */}
      <Dialog open={markPaidOpen} onOpenChange={open => { if (!open) { setMarkPaidOpen(false); setMarkPaidMethod('check'); setMarkPaidAmount(''); setMarkPaidDate(new Date().toISOString().slice(0, 10)); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment{selectedInvoice?.invoiceNumber ? ` — ${selectedInvoice.invoiceNumber}` : ''}</DialogTitle>
            <DialogDescription>
              {selectedInvoice ? `Invoice total: $${selectedInvoice.total.toFixed(2)}` : 'Choose the payment method used by the customer.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount Received <span className="text-muted-foreground font-normal">(blank = full)</span></label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                title="Amount received (leave blank to record full balance)"
                placeholder={selectedInvoice ? selectedInvoice.total.toFixed(2) : '0.00'}
                value={markPaidAmount}
                onChange={e => setMarkPaidAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment Method</label>
              <Select value={markPaidMethod} onValueChange={setMarkPaidMethod}>
                <SelectTrigger title="Select how this payment was received"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date Received</label>
              <Input type="date" title="Date the payment was received" value={markPaidDate} onChange={e => setMarkPaidDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" title="Close without recording a payment" onClick={() => setMarkPaidOpen(false)}>Cancel</Button>
            <Button
              className="gap-1.5"
              title="Confirm and mark this invoice as paid"
              disabled={updateInvoice.isPending}
              onClick={() => {
                if (!selectedInvoiceId) return;
                const paidAmount = markPaidAmount ? parseFloat(markPaidAmount) : undefined;
                updateInvoice.mutate(
                  { id: selectedInvoiceId, data: { status: 'paid', paymentMethod: markPaidMethod, ...(paidAmount ? { paidAmount } : {}), ...(markPaidDate ? { paidAt: new Date(markPaidDate + 'T12:00:00').toISOString() } : {}) } as any },
                  {
                    onSuccess: () => {
                      toast.success('Invoice marked as paid');
                      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                      qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(selectedInvoiceId) });
                      qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
                      setMarkPaidOpen(false);
                      setMarkPaidMethod('check');
                      setMarkPaidAmount('');
                      setMarkPaidDate(new Date().toISOString().slice(0, 10));
                    },
                    onError: () => toast.error('Failed to update invoice'),
                  },
                );
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> {updateInvoice.isPending ? 'Saving…' : 'Mark Paid'}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
