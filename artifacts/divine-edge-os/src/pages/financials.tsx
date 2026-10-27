import React, { useState, useEffect, useCallback } from 'react';
import { DeliveryHistory } from '@/components/billing/DeliveryHistory';
import { PaymentPolicyCard } from '@/components/billing/PaymentPolicyCard';
import { BillingEmailDeliveries } from '@/components/financials/BillingEmailDeliveries';
import { SendDocumentDialog, type DocumentLinkDetails } from '@/components/shared/SendDocumentDialog';
import {
  useListInvoices, getListInvoicesQueryKey,
  useGetInvoice, getGetInvoiceQueryKey,
  useGetFinancialsSummary, getGetFinancialsSummaryQueryKey,
  useUpdateInvoice,
  useMarkInvoicePaid,
  useChargeInvoiceCard,
  useArchiveInvoice,
  useRestoreInvoice,
  useDeleteInvoice,
  useGetJob, getGetJobQueryKey,
  useListRecurringTemplates, getListRecurringTemplatesQueryKey,
  useCreateRecurringTemplate,
  useUpdateRecurringTemplate,
  useDeleteRecurringTemplate,
  useRunRecurringTemplateNow,
  usePreviewRecurringTemplateBilling, getPreviewRecurringTemplateBillingQueryKey,
  useGetBillingAutomationStatus, getGetBillingAutomationStatusQueryKey,
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
  useListJobs, getListJobsQueryKey,
  useListProperties, getListPropertiesQueryKey,
  useUpdateJob,
  useListInvoiceTemplates, getListInvoiceTemplatesQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import type { RecurringInvoiceTemplate, BillingLineItem, StopServiceFlag, PlanCancelRequest, BillingPreviewGroup, BillingPreviewJob, InvoiceTemplate } from '@workspace/api-client-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import { Card, CardContent } from '@/components/ui/card';
import { printInvoice, buildInvoicePrintDocument } from '@/lib/printUtils';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { PreviewActions, SAMPLE_NOTICE } from '@/components/documents/PreviewActions';
import { WordingField } from '@/components/documents/WordingField';
import { buildPreviewInvoice, settingsTaxRate, normalizeWording } from '@/lib/documentPreview';
import { InvoiceDocument, businessProfileFromSettings } from '@/components/documents/InvoiceDocument';
import InvoiceTemplatesSettings from '@/components/settings/InvoiceTemplatesSettings';
import { Button } from '@/components/ui/button';
import { SearchableCombobox } from '@/components/shared/SearchableCombobox';
import { InventoryItemCombobox } from '@/components/inventory/InventoryItemCombobox';
import type { InventoryItem } from '@workspace/api-client-react';
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
  Briefcase, Loader2, Layers, MapPin,
} from 'lucide-react';
import { format } from 'date-fns';
import { useLocation, useSearch } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { RecurringTemplateSheet } from '@/components/financials/RecurringTemplateSheet';
import { BillingCoveragePanel } from '@/components/financials/BillingCoveragePanel';

const STATUS_COLORS: Record<string, string> = {
  paid:      'bg-emerald-100 text-emerald-800 border-transparent',
  overdue:   'bg-red-100 text-red-800 border-transparent',
  sent:      'bg-blue-100 text-blue-800 border-transparent',
  draft:     'bg-gray-100 text-gray-600 border-transparent',
  cancelled: 'bg-gray-200 text-gray-500 border-transparent',
};

interface LineItemRow { description: string; quantity: number; unitPrice: number; total: number; propertyId?: number | null; jobId?: number | null; serviceId?: number | null; inventoryItemId?: number | null; sku?: string | null; costPrice?: number | null; }
type InvoiceGrouping = 'combined' | 'by_property';

// ── Create Invoice Sheet ────────────────────────────────────────────────────────

interface ServiceOption { id: number; name: string; description: string | null; basePrice: number; }

interface CreateInvoiceSheetProps {
  open: boolean;
  onClose: () => void;
  customers: Array<{ id: number; name: string }>;
  invoiceDueDays?: number | null;
  onSaveAndSend?: (id: number) => void;
}

function CreateInvoiceSheet({ open, onClose, customers, invoiceDueDays, onSaveAndSend }: CreateInvoiceSheetProps) {
  const qc = useQueryClient();
  const createInvoice = useCreateInvoice();

  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [termsText, setTermsText] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [defaultPropertyId, setDefaultPropertyId] = useState<number | null>(null);
  const [grouping, setGrouping] = useState<InvoiceGrouping>('combined');
  const [groupingOverridden, setGroupingOverridden] = useState(false);
  const custNum = customerId ? parseInt(customerId, 10) : undefined;
  const propParams = custNum ? { customerId: custNum } : undefined;
  const propertiesQuery = useListProperties(propParams, {
    query: { enabled: open && !!custNum, queryKey: getListPropertiesQueryKey(propParams) },
  });
  const customerProperties = React.useMemo(
    () => (Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []).filter(p => p.customerId === custNum),
    [propertiesQuery.data, custNum],
  );
  const propertyLabel = (id: number | null | undefined) => {
    if (id == null) return null;
    const p = customerProperties.find(x => x.id === id);
    return p ? [p.address, p.city].filter(Boolean).join(', ') : `Property #${id}`;
  };
  const groupingQuery = useQuery<{ mode: InvoiceGrouping }>({
    queryKey: ['customer-invoice-grouping', custNum],
    queryFn: () => customFetch<{ mode: InvoiceGrouping }>(`/api/billing/customer-invoice-grouping/${custNum}`),
    enabled: open && !!custNum,
  });
  const savedGrouping: InvoiceGrouping = groupingQuery.data?.mode === 'by_property' ? 'by_property' : 'combined';
  React.useEffect(() => {
    if (!groupingOverridden) setGrouping(savedGrouping);
  }, [savedGrouping, groupingOverridden]);
  const { data: customerJobs, isLoading: jobsLoading } = useListJobs(custNum ? { customerId: custNum } : undefined, {
    query: { enabled: open && !!custNum, queryKey: getListJobsQueryKey(custNum ? { customerId: custNum } : undefined) },
  });
  // Only jobs for this customer that are not already billed.
  const unbilledJobs = React.useMemo(
    () => (customerJobs ?? []).filter(j => j.customerId === custNum && !j.invoiceId && j.status !== 'cancelled'),
    [customerJobs, custNum],
  );
  const { data: createSettings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  // Fetch invoice templates for the template selector
  const { data: invoiceTemplates } = useListInvoiceTemplates({
    query: { queryKey: getListInvoiceTemplatesQueryKey() },
  });

  // Fetch services for the service picker
  const { data: services } = useQuery<ServiceOption[]>({
    queryKey: ['services-for-invoice'],
    queryFn: () => customFetch<ServiceOption[]>('/api/services'),
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (open) {
      setCustomerId('');
      setCustomerSearch('');
      const today = new Date().toISOString().slice(0, 10);
      setInvoiceDate(today);
      const days = invoiceDueDays ?? 30;
      const due = new Date();
      due.setDate(due.getDate() + days);
      setDueDate(due.toISOString().slice(0, 10));
      setNotes((createSettings?.defaultInvoiceNotes as string | null) ?? '');
      setTemplateId('');
      setTermsText(null);
      setLineItems([{ description: '', quantity: 1, unitPrice: 0, total: 0 }]);
      setSelectedJobIds([]);
      setDefaultPropertyId(null);
      setGroupingOverridden(false);
      setGrouping('combined');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceDueDays]);

  // Jobs and properties belong to one customer; changing customer clears job links and properties
  // but keeps manually typed rows.
  React.useEffect(() => {
    setSelectedJobIds([]);
    setDefaultPropertyId(null);
    setGroupingOverridden(false);
    setLineItems(prev => {
      const kept = prev.filter(li => li.jobId == null).map(li => ({ ...li, propertyId: null, jobId: null }));
      return kept.length ? kept : [{ description: '', quantity: 1, unitPrice: 0, total: 0 }];
    });
  }, [customerId]);

  const isBlankRow = (li: LineItemRow) => li.jobId == null && !li.description.trim() && !li.unitPrice;
  const toggleJob = (jobId: number) => {
    const job = unbilledJobs.find(j => j.id === jobId);
    if (!job) return;
    if (selectedJobIds.includes(jobId)) {
      setSelectedJobIds(ids => ids.filter(x => x !== jobId));
      setLineItems(prev => {
        const next = prev.filter(li => li.jobId !== jobId);
        return next.length ? next : [{ description: '', quantity: 1, unitPrice: 0, total: 0 }];
      });
      return;
    }
    setSelectedJobIds(ids => [...ids, jobId]);
    const price = Number(job.totalAmount ?? 0);
    const line: LineItemRow = { description: job.title, quantity: 1, unitPrice: price, total: price, jobId, propertyId: job.propertyId ?? null };
    setLineItems(prev => {
      if (prev.some(li => li.jobId === jobId)) return prev.map(li => (li.jobId === jobId ? line : li));
      return [...prev.filter(li => !isBlankRow(li)), line];
    });
  };

  // Pre-fill customer from external event (e.g. from customer detail page)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const cid = (e as CustomEvent<string>).detail;
      if (cid) setCustomerId(cid);
    };
    document.addEventListener('financials:prefillCustomer', handler);
    return () => document.removeEventListener('financials:prefillCustomer', handler);
  }, []);

  // When a template is selected, pre-fill its line items
  const handleTemplateChange = (val: string) => {
    setTemplateId(val);
    if (!val || val === '__none__') return;
    const tmpl = (invoiceTemplates ?? []).find(t => String(t.id) === val);
    if (tmpl?.lineItems && tmpl.lineItems.length > 0) {
      setLineItems(tmpl.lineItems.map(li => ({
        description: li.description ?? '',
        quantity: li.quantity ?? 1,
        unitPrice: li.unitPrice ?? 0,
        total: (li.quantity ?? 1) * (li.unitPrice ?? 0),
        propertyId: null, jobId: null,
      })));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItemRow, value: string | number | null) => {
    setLineItems(prev => prev.map((li, i) => {
      if (i !== index) return li;
      const updated = { ...li, [field]: value };
      updated.total = updated.quantity * updated.unitPrice;
      return updated;
    }));
  };

  // When a service is selected for a line item, auto-fill description + price
  const applyService = (index: number, serviceId: string) => {
    if (!serviceId || serviceId === '__none__') return;
    const svc = (services ?? []).find(s => String(s.id) === serviceId);
    if (!svc) return;
    setLineItems(prev => prev.map((li, i) => {
      if (i !== index) return li;
      const desc = svc.description?.trim() || svc.name;
      const updated = { ...li, description: desc, unitPrice: svc.basePrice, total: li.quantity * svc.basePrice, serviceId: svc.id, inventoryItemId: null, sku: null, costPrice: null };
      return updated;
    }));
  };

  // Inventory part selection: fills description/price and carries inventory metadata on the line
  const applyInventory = (index: number, item: InventoryItem) => {
    setLineItems(prev => prev.map((li, i) => {
      if (i !== index) return li;
      const price = Number(item.unitPrice ?? 0);
      return { ...li, description: item.name, unitPrice: price, total: li.quantity * price, inventoryItemId: item.id, sku: item.sku ?? null, costPrice: item.costPrice ?? null, serviceId: null };
    }));
  };

  const subtotal = lineItems.reduce((s, li) => s + li.total, 0);

  const chosenDesign = (invoiceTemplates ?? []).find(t => String(t.id) === templateId) as any;
  const defaultTerms = (chosenDesign?.termsText ?? createSettings?.defaultInvoiceTerms ?? '') as string;
  const previewPropertyFor = (li: LineItemRow) => li.jobId
    ? unbilledJobs.find(job => job.id === li.jobId)?.propertyId ?? null
    : li.propertyId ?? defaultPropertyId ?? null;
  const previewPropertyIds = [...new Set(lineItems.map(previewPropertyFor))];
  const buildDraftPreview = (property?: number | null) => {
    const cust = customers.find(c => String(c.id) === customerId);
    const base = buildPreviewInvoice({
      lines: lineItems.filter(li => property === undefined || previewPropertyFor(li) === property).map(li => {
        const label = propertyLabel(previewPropertyFor(li));
        return label ? { ...li, description: `[${label}] ${li.description}` } : li;
      }), notes, termsText: termsText === null ? defaultTerms : termsText,
      layout: chosenDesign?.layout ?? 'clean',
      lateFeeEnabled: chosenDesign?.lateFeeEnabled, lateFeeType: chosenDesign?.lateFeeType, lateFeeAmount: chosenDesign?.lateFeeAmount, lateFeeDaysGrace: chosenDesign?.lateFeeDaysGrace,
      customerName: cust?.name ?? null,
      taxRatePct: settingsTaxRate(createSettings),
      tenantId: (createSettings as any)?.tenantId ?? null,
    });
    return { ...base, createdAt: invoiceDate ? new Date(`${invoiceDate}T12:00:00`).toISOString() : base.createdAt, dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : base.dueDate };
  };
  const draftPreviews = () => grouping === 'by_property' && previewPropertyIds.length
    ? previewPropertyIds.map(property => buildDraftPreview(property)) : [buildDraftPreview()];
  const buildDraftPrintDocument = () => {
    const documents = draftPreviews().map(invoice => buildInvoicePrintDocument(invoice as any, (createSettings ?? {}) as Record<string, unknown>));
    // Same design/styles for every property; add each remaining document body
    // on its own printed page rather than showing a misleading combined total.
    return documents[0].replace('</body>', documents.slice(1).map(document =>
      `<div style="break-before:page;page-break-before:always">${document.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? ''}</div>`).join('') + '</body>');
  };

  const handleSave = (andSend = false) => {
    if (!customerId) { toast.error('Customer is required'); return; }
    if (!groupingOverridden && (groupingQuery.isPending || groupingQuery.isError)) {
      toast.error('Wait for the customer billing choice to load, or explicitly choose how to group this invoice.'); return;
    }
    const validLineItems = lineItems
      .filter(li => li.description.trim() !== '')
      .map(li => ({
        description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total,
        jobId: li.jobId ?? null,
        ...(li.serviceId ? { serviceId: li.serviceId } : {}),
        ...(li.inventoryItemId ? { inventoryItemId: li.inventoryItemId, sku: li.sku ?? null } : {}),
        propertyId: li.jobId != null ? (li.propertyId ?? null) : (li.propertyId ?? defaultPropertyId ?? null),
      }));
    createInvoice.mutate(
      {
        data: {
          customerId: parseInt(customerId, 10),
          ...(selectedJobIds.length === 1 ? { jobId: selectedJobIds[0] } : {}),
          jobIds: selectedJobIds,
          propertyId: defaultPropertyId,
          grouping,
          notes: notes || undefined,
          invoiceDate: invoiceDate || undefined,
          dueDate: dueDate || undefined,
          lineItems: validLineItems.length > 0 ? validLineItems : undefined,
          invoiceTemplateId: (templateId && templateId !== '__none__') ? parseInt(templateId, 10) : undefined,
          ...(termsText !== null ? { termsText: normalizeWording(termsText) } : {}),
        } as any,
      },
      {
        onSuccess: (data: any) => {
          const ids: number[] = Array.isArray(data?.invoiceIds) && data.invoiceIds.length ? data.invoiceIds : (data?.id ? [data.id] : []);
          const count = Math.max(ids.length, 1);
          toast.success(count > 1 ? `${count} invoices created, one per property` : 'Invoice created');
          qc.invalidateQueries({ queryKey: ['customer-credits'] });
          qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
          qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
          onClose();
          const firstId = data?.id ?? ids[0];
          if (andSend && firstId && onSaveAndSend) {
            onSaveAndSend(firstId);
            if (count > 1) toast.info(`Opening the first invoice to send. The other ${count - 1} invoice${count - 1 === 1 ? ' is' : 's are'} in the invoice list; share each one individually.`, { duration: 9000 });
          }
        },
        onError: (e: unknown) => {
          const d = (e as { data?: { error?: string; message?: string } })?.data;
          toast.error(d?.error || d?.message || 'Failed to create invoice');
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[66vw] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Create Invoice</SheetTitle>
          <SheetDescription>Create a one-off invoice for a customer.</SheetDescription>
        </SheetHeader>
        <div className="sticky top-0 z-10 -mx-6 px-6 py-2 mb-3 bg-background/95 backdrop-blur border-b flex justify-end">
          <PreviewActions
            title="New invoice preview"
            sampleNotice={customerId ? 'Preview of this unsaved invoice. Not saved and not sent.' : SAMPLE_NOTICE}
            renderCustomerView={() => <div className="space-y-8">{draftPreviews().map((invoice, index) => <section key={index}>
              {grouping === 'by_property' && <p className="mb-2 text-sm font-medium">Separate property invoice {index + 1} of {draftPreviews().length}</p>}
              <InvoiceDocument invoice={invoice} businessProfile={businessProfileFromSettings(createSettings)} preview />
            </section>)}</div>}
            buildPrintDocument={buildDraftPrintDocument}
            testIdPrefix="create-invoice-preview"
          />
        </div>

        <div className="space-y-5 pb-6">

          {/* Customer */}
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
                {customers
                  .filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                  .map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Jobs to bill (optional, multiple) */}
          <fieldset className="space-y-1.5" data-testid="fieldset-invoice-jobs">
            <legend className="text-sm font-medium flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5 text-muted-foreground" /> Jobs to bill <span className="text-xs font-normal text-muted-foreground">(optional, select any)</span></legend>
            {!customerId ? (
              <p className="text-xs text-muted-foreground">Pick a customer first.</p>
            ) : jobsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading unbilled jobs...</div>
            ) : unbilledJobs.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="text-no-unbilled-jobs">No unbilled jobs for this customer.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y" data-testid="list-invoice-jobs">
                {unbilledJobs.map(j => {
                  const checked = selectedJobIds.includes(j.id);
                  return (
                    <label key={j.id} className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${checked ? 'bg-primary/5' : ''}`}>
                      <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} onChange={() => toggleJob(j.id)} data-testid={`checkbox-invoice-job-${j.id}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{j.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {j.scheduledAt ? new Date(j.scheduledAt).toLocaleDateString() + ' - ' : ''}{j.propertyAddress || propertyLabel(j.propertyId) || 'No property'}
                        </span>
                      </span>
                      <span className={`text-xs tabular-nums ${Number(j.totalAmount ?? 0) === 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>${Number(j.totalAmount ?? 0).toFixed(2)}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedJobIds.some(id => Number(unbilledJobs.find(j => j.id === id)?.totalAmount ?? 0) === 0) && (
              <p className="text-xs text-amber-700">A selected job has no price. Set a price on the line or the job if it should be billed.</p>
            )}
            {selectedJobIds.length > 0 && <p className="text-xs text-muted-foreground">Each selected job adds one line at its own property. Lines you typed are kept. The server checks jobs are not already invoiced.</p>}
          </fieldset>

          {/* Property defaults and grouping */}
          {customerId && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5" htmlFor="select-invoice-default-property"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> Default property <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                {propertiesQuery.isLoading ? (
                  <div className="h-9 rounded-md bg-muted animate-pulse" />
                ) : propertiesQuery.isError ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                    <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Could not load properties.</span>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => propertiesQuery.refetch()} data-testid="button-retry-invoice-properties">Retry</Button>
                  </div>
                ) : (
                  <Select value={defaultPropertyId != null ? String(defaultPropertyId) : '__none__'} onValueChange={v => setDefaultPropertyId(v === '__none__' ? null : Number(v))} disabled={customerProperties.length === 0}>
                    <SelectTrigger id="select-invoice-default-property" data-testid="select-invoice-default-property"><SelectValue placeholder="No default property" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No default (general)</SelectItem>
                      {customerProperties.map(p => <SelectItem key={p.id} value={String(p.id)}>{propertyLabel(p.id)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  {!propertiesQuery.isLoading && !propertiesQuery.isError && customerProperties.length === 0 ? 'This customer has no properties on file.' : 'Applies to typed lines without their own property.'}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5" htmlFor="select-invoice-grouping"><Layers className="w-3.5 h-3.5 text-muted-foreground" /> Invoice grouping</label>
                <Select value={grouping} onValueChange={v => { setGrouping(v as InvoiceGrouping); setGroupingOverridden(true); }}>
                  <SelectTrigger id="select-invoice-grouping" data-testid="select-invoice-grouping"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="combined">One invoice, all properties</SelectItem>
                    <SelectItem value="by_property">Separate invoice per property</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground" data-testid="text-invoice-grouping-source">
                  {groupingQuery.isLoading ? 'Loading customer preference...'
                    : groupingQuery.isError ? 'Could not load customer preference; using combined.'
                    : groupingOverridden && grouping !== savedGrouping ? 'Changed for this invoice only. Customer preference is unchanged.'
                    : 'Customer preference.'}
                  {grouping === 'by_property' && ' One invoice will be created per property.'}
                </p>
              </div>
            </div>
          )}

          {/* Template selector */}
          {(invoiceTemplates ?? []).length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" /> Invoice Template
              </label>
              <Select value={templateId} onValueChange={handleTemplateChange}>
                <SelectTrigger title="Choose an invoice template to apply formatting and pre-fill line items">
                  <SelectValue placeholder="— Use tenant default —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Use tenant default —</SelectItem>
                  {(invoiceTemplates ?? []).map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} <span className="text-muted-foreground text-xs ml-1 capitalize">({t.layout})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templateId && templateId !== '__none__' && (
                <p className="text-xs text-muted-foreground">Line items pre-filled from template — you can edit them below.</p>
              )}
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Invoice Date</label>
              <Input type="date" title="Date the invoice is issued" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Due Date</label>
              <Input type="date" title="Payment due date for this invoice" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Line Items</label>

            <div className="space-y-3">
              {lineItems.map((li, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  {/* Service / parts picker row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {(services ?? []).length > 0 && (
                      <SearchableCombobox
                        className="flex-1 min-w-[150px]"
                        options={(services ?? []).map(s => ({ value: String(s.id), label: s.name, keywords: [s.description ?? ''], hint: s.basePrice > 0 ? `$${s.basePrice.toFixed(2)}` : undefined }))}
                        value={li.serviceId ? String(li.serviceId) : null}
                        onChange={v => applyService(i, v)}
                        placeholder="Pick a service..."
                        searchPlaceholder="Search services..."
                        emptyText="No services match."
                        ariaLabel={`Service for line ${i + 1}`}
                        title="Pick a service to auto-fill description and price"
                      />
                    )}
                    <InventoryItemCombobox
                      className="flex-1 min-w-[150px]"
                      value={li.inventoryItemId ?? null}
                      onSelect={item => applyInventory(i, item)}
                      placeholder="Pick a part..."
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      title="Remove this line item"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLineItems(p => p.filter((_, j) => j !== i))}
                      disabled={lineItems.length === 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {li.inventoryItemId != null && (
                    <p className="text-[10px] text-muted-foreground">Inventory part{li.sku ? ` · SKU ${li.sku}` : ''}{li.costPrice != null ? ` · cost $${Number(li.costPrice).toFixed(2)}` : ''}. Invoice lines bill the customer; record stock usage on the job.</p>
                  )}

                  {/* Property */}
                  {customerId && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
                      {li.jobId != null ? (
                        <span className="text-xs text-muted-foreground" data-testid={`text-line-property-${i}`}>
                          Job line at {propertyLabel(li.propertyId) ?? 'no property'} (fixed to the job)
                        </span>
                      ) : (
                        <Select value={li.propertyId != null ? String(li.propertyId) : '__none__'} onValueChange={v => updateLineItem(i, 'propertyId', v === '__none__' ? null : Number(v))} disabled={customerProperties.length === 0}>
                          <SelectTrigger className="h-8 text-xs flex-1" aria-label={`Property for line ${i + 1}`} data-testid={`select-line-property-${i}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{defaultPropertyId != null ? `Default: ${propertyLabel(defaultPropertyId)}` : 'General charge (no property)'}</SelectItem>
                            {customerProperties.map(p => <SelectItem key={p.id} value={String(p.id)}>{propertyLabel(p.id)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  {/* Description */}
                  <Input
                    className="h-8 text-sm"
                    title="Line item description"
                    placeholder="Description"
                    value={li.description}
                    onChange={e => updateLineItem(i, 'description', e.target.value)}
                  />

                  {/* Qty / Unit Price / Total */}
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quantity</p>
                      <Input
                        className="h-8 text-sm"
                        type="number"
                        min={1}
                        title="Quantity"
                        placeholder="Quantity"
                        value={li.quantity}
                        onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Unit Price</p>
                      <Input
                        className="h-8 text-sm"
                        type="number"
                        min={0}
                        step={0.01}
                        title="Price per unit"
                        placeholder="Unit Price"
                        value={li.unitPrice}
                        onChange={e => updateLineItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total</p>
                      <div className="h-8 flex items-center px-2 rounded-md border bg-muted/50 text-sm font-semibold">
                        ${li.total.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Line — centered below items, prominent */}
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="default"
                className="gap-2 w-48"
                title="Add a new line item to this invoice"
                onClick={() => setLineItems(p => [...p, { description: '', quantity: 1, unitPrice: 0, total: 0 }])}
              >
                <Plus className="w-4 h-4" /> Add Line Item
              </Button>
            </div>

            <div className="flex justify-end pr-1 pt-1">
              <div className="text-sm font-semibold border-t pt-2 w-48 text-right">
                Subtotal: ${subtotal.toFixed(2)}
              </div>
            </div>
          </div>

          <Separator />

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={2} title="Optional notes printed on this invoice" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes on invoice" />
          </div>
          <div>
            <WordingField label="Terms" value={termsText} onChange={setTermsText} defaultText={defaultTerms}
              defaultSource={chosenDesign ? `invoice template "${chosenDesign.name}"` : 'company default (Settings, Invoicing)'} />
          </div>

          <div className="flex gap-3">
            <Button className="flex-1" variant="outline" size="lg" title="Create invoice and close" onClick={() => handleSave(false)} disabled={createInvoice.isPending}>
              {createInvoice.isPending ? 'Creating…' : 'Save & Close'}
            </Button>
            <Button className="flex-1 gap-2" size="lg" title="Create invoice then open send options" onClick={() => handleSave(true)} disabled={createInvoice.isPending}>
              <Send className="w-4 h-4" />
              {createInvoice.isPending ? 'Creating…' : 'Save & Send'}
            </Button>
          </div>
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
  const { data: preview, isLoading } = usePreviewRecurringTemplateBilling(
    templateId ?? 0,
    { query: { queryKey: getPreviewRecurringTemplateBillingQueryKey(templateId ?? 0), enabled: templateId != null } }
  );
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const groups: BillingPreviewGroup[] = (preview as any)?.groups ?? [];
  const totalCount = groups.reduce((s: number, g: BillingPreviewGroup) => s + g.jobs.length, 0);

  return (
    <Dialog open={templateId != null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview Billing: {templateName}</DialogTitle>
          <DialogDescription>Review and optionally exclude jobs before generating invoices.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading preview…</div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No completed jobs to bill for this template.</div>
          ) : groups.map((g: BillingPreviewGroup) => (
            <div key={g.customerId} className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
                <span className="font-semibold text-sm">{g.customerName}</span>
                <span className="text-xs text-muted-foreground">{g.jobs.length} job{g.jobs.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y">
                {g.jobs.map((job: BillingPreviewJob) => (
                  <div key={job.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={!excluded.has(job.id)}
                      onChange={e => {
                        setExcluded(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.delete(job.id) : next.add(job.id);
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{job.title}</p>
                      {job.completedAt && <p className="text-xs text-muted-foreground">{new Date(job.completedAt).toLocaleDateString()}</p>}
                    </div>
                    <span className="font-medium shrink-0">${job.totalAmount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onGenerate(Array.from(excluded))} disabled={isGenerating || totalCount === 0}>
            {isGenerating ? 'Generating…' : `Generate ${totalCount - excluded.size} Invoice${totalCount - excluded.size !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Invoice Sheet ──────────────────────────────────────────────────────────

function EditInvoiceSheet({ invoiceId, onClose, onRestored, autoOpenSend }: { invoiceId: number | null; onClose: () => void; onRestored?: () => void; autoOpenSend?: boolean }) {
  const qc = useQueryClient();
  const { data: invoice, isLoading } = useGetInvoice(invoiceId ?? 0, {
    query: { queryKey: getGetInvoiceQueryKey(invoiceId ?? 0), enabled: invoiceId != null },
  });
  const updateInvoice = useUpdateInvoice();
  const markPaid = useMarkInvoicePaid();
  const chargeCard = useChargeInvoiceCard();
  const [chargeConfirmOpen, setChargeConfirmOpen] = useState(false);
  const [chargeResult, setChargeResult] = useState<{ status: string; message: string } | null>(null);
  const archiveInvoice = useArchiveInvoice();
  const restoreInvoice = useRestoreInvoice();
  const deleteInvoice = useDeleteInvoice();
  const updateJob = useUpdateJob();
  const sendReminder = useSendInvoiceReminder();
  const printMail = usePrintMailInvoice();
  const { data: job } = useGetJob((invoice as any)?.jobId ?? 0, {
    query: { queryKey: getGetJobQueryKey((invoice as any)?.jobId ?? 0), enabled: !!(invoice as any)?.jobId },
  });
  const { user, canManageOffice } = useAuth();
  const { data: tenantSettings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const [termsDraft, setTermsDraft] = useState('');
  const [layoutDraft, setLayoutDraft] = useState('clean');

  const [editingLineItems, setEditingLineItems] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentCardBrand, setPaymentCardBrand] = useState('');
  const [paymentCardLast4, setPaymentCardLast4] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (invoice) {
      const li = ((invoice as any).lineItems ?? []) as LineItemRow[];
      setLineItems(li.map(l => ({ ...l, total: l.quantity * l.unitPrice })));
      setNotes((invoice as any).notes ?? '');
      setTermsDraft((invoice as any).termsText ?? '');
      setLayoutDraft((invoice as any).layout ?? 'clean');
      setDueDate((invoice as any).dueDate ? new Date((invoice as any).dueDate).toISOString().slice(0, 10) : '');
    }
  }, [invoice]);

  // Auto-open send dialog when navigated here via "Save & Send"
  useEffect(() => {
    if (autoOpenSend && invoice) setShowSendDialog(true);
  }, [autoOpenSend, invoice]);

  const invalidateInvoice = () => {
    qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId ?? 0) });
    qc.invalidateQueries({ queryKey: ['customer-credits'] });
    qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
  };

  const handleStatusChange = (status: string) => {
    if (!invoiceId) return;
    updateInvoice.mutate({ id: invoiceId, data: { status } as any }, {
      onSuccess: () => { toast.success(status === 'sent' ? 'Invoice sent. Customer email queued.' : `Invoice marked ${status}`); invalidateInvoice(); },
      onError: (err: any) => {
        const msg = err?.data?.error ?? err?.response?.data?.error;
        if (err?.status === 403) toast.error(msg ?? 'Only admins can send invoices');
        else toast.error(msg ?? (status === 'sent' ? 'Invoice was not sent' : 'Failed to update invoice status'));
      },
    });
  };

  const handleSaveLineItems = () => {
    if (!invoiceId) return;
    const validLi = lineItems.filter(li => li.description.trim() !== '');
    const subtotal = validLi.reduce((s, li) => s + li.total, 0);
    const tax = subtotal * 0.085;
    const total = subtotal + tax;
    updateInvoice.mutate({ id: invoiceId, data: { lineItems: validLi, subtotal, tax, total } as any }, {
      onSuccess: () => { toast.success('Line items updated'); invalidateInvoice(); setEditingLineItems(false); },
      onError: () => toast.error('Failed to update line items'),
    });
  };

  const handleSaveNotes = () => {
    if (!invoiceId) return;
    updateInvoice.mutate({ id: invoiceId, data: { notes } as any }, {
      onSuccess: () => { toast.success('Notes updated'); invalidateInvoice(); setEditingNotes(false); },
      onError: () => toast.error('Failed to update notes'),
    });
  };

  const handleSaveWording = () => {
    if (!invoiceId) return;
    updateInvoice.mutate({ id: invoiceId, data: { termsText: termsDraft.trim() === '' ? '' : termsDraft, layout: layoutDraft as 'clean' | 'detailed' | 'compact' } }, {
      onSuccess: () => { toast.success('Terms and layout saved for this invoice'); invalidateInvoice(); },
      onError: (err: any) => toast.error(err?.data?.error ?? err?.response?.data?.error ?? 'Failed to save terms and layout'),
    });
  };

  /** Current on-screen state, including unsaved edits, for previews. */
  const livePreviewInvoice = () => {
    const inv = (invoice ?? {}) as any;
    const li = editingLineItems ? lineItems.filter(l => l.description.trim() !== '') : (inv.lineItems ?? []);
    const sub = editingLineItems ? li.reduce((s: number, l: LineItemRow) => s + l.quantity * l.unitPrice, 0) : inv.subtotal;
    const tax = editingLineItems ? sub * 0.085 : inv.tax;
    return {
      ...inv,
      lineItems: li,
      subtotal: sub,
      tax,
      total: editingLineItems ? sub + tax : inv.total,
      notes: editingNotes ? notes : inv.notes,
      termsText: inv.status === 'draft' ? termsDraft : inv.termsText,
      layout: inv.status === 'draft' ? layoutDraft : inv.layout,
      dueDate: editingDueDate && dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : inv.dueDate,
    };
  };

  const handleSaveDueDate = () => {
    if (!invoiceId) return;
    updateInvoice.mutate({ id: invoiceId, data: { dueDate: dueDate || null } as any }, {
      onSuccess: () => { toast.success('Due date updated'); invalidateInvoice(); setEditingDueDate(false); },
      onError: () => toast.error('Failed to update due date'),
    });
  };

  const handleHoldBilling = () => {
    if (!(invoice as any)?.jobId) return;
    updateJob.mutate({ id: (invoice as any).jobId, data: { holdBilling: true } as any }, {
      onSuccess: () => { toast.success('Job billing held'); invalidateInvoice(); },
      onError: () => toast.error('Failed to hold billing'),
    });
  };

  const updateLineItem = (index: number, field: keyof LineItemRow, value: string | number) => {
    setLineItems(prev => prev.map((li, i) => {
      if (i !== index) return li;
      const updated = { ...li, [field]: value };
      updated.total = updated.quantity * updated.unitPrice;
      return updated;
    }));
  };

  const subtotal = lineItems.reduce((s, li) => s + li.total, 0);
  const canSend = user?.role !== 'technician';
  const canManageLifecycle = ['company_owner', 'office_manager', 'department_manager'].includes(user?.role ?? '');
  const canPermanentlyDelete = user?.role === 'company_owner';
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const handleSendInvoiceEmail = useCallback((): Promise<void> => {
    setIsSendingEmail(true);
    return customFetch(`/api/invoices/${invoiceId}/resend-email`, { method: 'POST' })
      .then(() => { toast.success('Invoice email processed. Check Email deliveries for its status.'); })
      .catch((err) => { toast.error(err?.data?.error ?? 'Unable to resend. Check Email deliveries for unresolved attempts.'); throw new Error('Failed'); })
      .finally(() => setIsSendingEmail(false));
  }, [invoiceId]);

  const STATUS_ACTIONS: Record<string, { label: string; variant: 'default' | 'outline' | 'destructive' }[]> = {
    draft: [{ label: 'Send Invoice', variant: 'default' }],
    sent: [{ label: 'Mark Paid', variant: 'default' }, { label: 'Mark Draft', variant: 'outline' }],
    overdue: [{ label: 'Mark Paid', variant: 'default' }],
    paid: [],
  };

  const handleMarkPaid = () => {
    if (!invoiceId || !paymentMethod) return;
    markPaid.mutate({
      id: invoiceId,
      data: {
        paymentMethod: paymentMethod as 'cash' | 'check' | 'card' | 'ach' | 'bank_transfer' | 'other',
        paymentReference: paymentReference.trim() || null,
        paymentCardBrand: paymentMethod === 'card' ? paymentCardBrand.trim() || null : null,
        paymentCardLast4: paymentMethod === 'card' ? paymentCardLast4.trim() || null : null,
      },
    }, {
      onSuccess: () => {
        toast.success('Invoice marked paid');
        setPaymentDialogOpen(false);
        setPaymentMethod(''); setPaymentReference(''); setPaymentCardBrand(''); setPaymentCardLast4('');
        invalidateInvoice();
      },
      onError: (err: any) => toast.error(err?.response?.data?.error ?? err?.message ?? 'Failed to record payment'),
    });
  };

  const handleChargeCard = () => {
    if (!invoiceId) return;
    setChargeResult(null);
    chargeCard.mutate({ id: invoiceId }, {
      onSuccess: res => {
        setChargeResult(res);
        if (res.status === 'paid') toast.success(res.message);
        else if (res.status === 'pending') toast.info(res.message);
        else toast.error(res.message);
        invalidateInvoice();
      },
      onError: (err: any) => {
        const message = err?.data?.error ?? err?.data?.message ?? err?.message ?? 'Charge failed. The invoice was not marked paid.';
        setChargeResult({ status: 'failed', message });
        toast.error(message);
        invalidateInvoice();
      },
    });
  };

  const runLifecycle = (action: 'archive' | 'restore') => {
    if (!invoiceId) return;
    const mutation = action === 'archive' ? archiveInvoice : restoreInvoice;
    mutation.mutate({ id: invoiceId }, {
      onSuccess: () => {
        toast.success(action === 'archive' ? 'Invoice archived' : 'Invoice restored');
        invalidateInvoice();
        if (action === 'restore') onRestored?.();
        onClose();
      },
      onError: (err: any) => toast.error(err?.response?.data?.error ?? err?.message ?? `Failed to ${action} invoice`),
    });
  };

  return (
    <Sheet open={invoiceId != null} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[66vw] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Invoice {(invoice as any)?.invoiceNumber ?? ''}
          </SheetTitle>
          <SheetDescription>
            {invoice ? `${(invoice as any).customerName ?? ''}${(invoice as any).dueDate ? ` · Due ${new Date((invoice as any).dueDate).toLocaleDateString()}` : ''}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !invoice ? null : (
          <div className="space-y-5 pb-6">
            {canManageOffice && invoice.customerId > 0 && (
              <details className="rounded-lg border p-3" data-testid="invoice-customer-payment-rules">
                <summary className="cursor-pointer text-sm font-medium">Customer prepayment and deposit rules</summary>
                <p className="mt-2 mb-3 text-xs text-muted-foreground">
                  Require payment before future services for this customer, or change their deposit requirement.
                  Available for paid and overdue invoices too. This does not change this invoice, its balance, or its payment history.
                </p>
                <PaymentPolicyCard scope="customer" id={invoice.customerId} canEdit={!!canManageOffice} title="Customer payment requirements" />
              </details>
            )}
            {/* Status + Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`${STATUS_COLORS[(invoice as any).status] ?? ''} border text-xs px-2 py-0.5 capitalize`}>
                {(invoice as any).status}
              </Badge>
              {canManageLifecycle && (STATUS_ACTIONS[(invoice as any).status] ?? []).map(action => (
                <Button
                  key={action.label}
                  size="sm"
                  variant={action.variant}
                  onClick={() => action.label === 'Mark Paid' ? setPaymentDialogOpen(true) : handleStatusChange(action.label === 'Mark Sent' || action.label === 'Send Invoice' ? 'sent' : 'draft')}
                  disabled={updateInvoice.isPending || markPaid.isPending}
                >
                  {action.label}
                </Button>
              ))}
              {canManageLifecycle && ((invoice as any).status === 'sent' || (invoice as any).status === 'overdue') && Number((invoice as any).balanceDue ?? (invoice as any).total ?? 0) > 0 && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setChargeResult(null); setChargeConfirmOpen(true); }}
                  disabled={chargeCard.isPending} data-testid="button-charge-saved-card">
                  <DollarSign className="w-3.5 h-3.5" /> Charge saved card
                </Button>
              )}
              {canManageLifecycle && (invoice as any).status !== 'paid' && (invoice as any).status !== 'cancelled' && (
                <Button size="sm" variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/5"
                  onClick={() => handleStatusChange('cancelled')} disabled={updateInvoice.isPending}>
                  Cancel
                </Button>
              )}
              {canManageLifecycle && (
                (invoice as any).archivedAt ? (
                  <Button size="sm" variant="outline" onClick={() => runLifecycle('restore')} disabled={restoreInvoice.isPending}>Restore</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => runLifecycle('archive')} disabled={archiveInvoice.isPending}>Archive</Button>
                )
              )}
              {canPermanentlyDelete && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )}
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-2" data-testid="invoice-preview-bar">
              <div className="text-sm">
                <p className="font-medium">See what the customer gets</p>
                <p className="text-xs text-muted-foreground">{(invoice as any).status === 'draft' ? 'Includes unsaved edits on this screen. Nothing is sent.' : 'Shows this invoice as issued. Template changes do not alter it.'}</p>
              </div>
              <PreviewActions
                title={`Preview ${(invoice as any).invoiceNumber ?? ''}`}
                renderCustomerView={() => <InvoiceDocument invoice={livePreviewInvoice()} businessProfile={businessProfileFromSettings(tenantSettings)} preview />}
                buildPrintDocument={() => buildInvoicePrintDocument(livePreviewInvoice() as Record<string, unknown>, (tenantSettings ?? {}) as unknown as Record<string, unknown>)}
                testIdPrefix="invoice-preview"
              />
            </div>

            {(invoice as any).paidAt && (
              <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm">
                <p className="font-medium text-emerald-900">Paid {format(new Date((invoice as any).paidAt), 'MMM d, yyyy h:mm a')}</p>
                <p className="text-emerald-800 capitalize">
                  {String((invoice as any).paymentMethod ?? 'payment').replace('_', ' ')}
                  {(invoice as any).paymentCardBrand ? ` · ${(invoice as any).paymentCardBrand}` : ''}
                  {(invoice as any).paymentCardLast4 ? ` ending ${(invoice as any).paymentCardLast4}` : ''}
                  {(invoice as any).paymentReference ? ` · Ref ${(invoice as any).paymentReference}` : ''}
                </p>
              </div>
            )}

            {/* Quick actions */}
            {canSend && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => sendReminder.mutate({ id: invoiceId! }, { onSuccess: () => toast.success('Reminder sent'), onError: () => toast.error('Failed to send reminder') })}
                  disabled={sendReminder.isPending}>
                  <Mail className="w-3.5 h-3.5" /> Send Reminder
                </Button>
                <Button size="sm" variant="default" className="gap-1.5"
                  onClick={() => setShowSendDialog(true)}>
                  <Send className="w-3.5 h-3.5" /> Send…
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printInvoice((invoice ?? {}) as unknown as Record<string, unknown>, (tenantSettings ?? {}) as unknown as Record<string, unknown>)}>
                  <Printer className="w-3.5 h-3.5" /> Print
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => printMail.mutate({ id: invoiceId! }, { onSuccess: () => toast.success('Print & mail requested'), onError: () => toast.error('Failed') })}
                  disabled={printMail.isPending}>
                  <Send className="w-3.5 h-3.5" /> Print & Mail
                </Button>
                {(invoice as any)?.jobId && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50"
                    onClick={handleHoldBilling} disabled={updateJob.isPending}>
                    <Pause className="w-3.5 h-3.5" /> Hold Billing
                  </Button>
                )}
              </div>
            )}

            {/* Send dialog */}
            <SendDocumentDialog
              open={showSendDialog}
              onOpenChange={setShowSendDialog}
              type="invoice"
              docNumber={(invoice as any).invoiceNumber ?? String(invoiceId)}
              customerName={(invoice as any).customerName ?? null}
              loadPublicLink={() => customFetch<DocumentLinkDetails>(`/api/invoices/${invoiceId}/share-link`)}
              generatePublicLink={() => customFetch<DocumentLinkDetails>(`/api/invoices/${invoiceId}/share-link`, { method: 'POST' })}
              onSendEmail={handleSendInvoiceEmail}
              isSendingEmail={isSendingEmail}
            />

            {/* Public link */}

            {/* Due Date */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Due Date</label>
                {!editingDueDate && <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingDueDate(true)}><Pencil className="w-3 h-3" /> Edit</Button>}
              </div>
              {editingDueDate ? (
                <div className="flex gap-2">
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-8" />
                  <Button size="sm" onClick={handleSaveDueDate} disabled={updateInvoice.isPending}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDueDate(false)}>Cancel</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{(invoice as any).dueDate ? new Date((invoice as any).dueDate).toLocaleDateString() : '—'}</p>
              )}
            </div>

            <Separator />

            {/* Line Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Line Items</label>
                {!editingLineItems && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingLineItems(true)}>
                    <Pencil className="w-3 h-3" /> Edit
                  </Button>
                )}
              </div>
              {editingLineItems ? (
                <div className="space-y-2">
                  {lineItems.map((li, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5 items-center text-sm">
                      <Input className="col-span-5 h-8 text-xs" placeholder="Description" value={li.description} onChange={e => updateLineItem(i, 'description', e.target.value)} />
                      <Input className="col-span-2 h-8 text-xs" type="number" min={1} placeholder="Quantity" value={li.quantity} onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)} />
                      <Input className="col-span-3 h-8 text-xs" type="number" min={0} step={0.01} placeholder="Unit Price" value={li.unitPrice} onChange={e => updateLineItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} />
                      <span className="col-span-1 text-xs text-right font-medium">${li.total.toFixed(0)}</span>
                      <Button variant="ghost" size="icon" className="col-span-1 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setLineItems(p => p.filter((_, j) => j !== i))} disabled={lineItems.length === 1}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setLineItems(p => [...p, { description: '', quantity: 1, unitPrice: 0, total: 0 }])}>
                    <Plus className="w-3 h-3" /> Add Line
                  </Button>
                  <div className="text-sm font-semibold text-right pr-8">Subtotal: ${subtotal.toFixed(2)}</div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveLineItems} disabled={updateInvoice.isPending}>Save Line Items</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingLineItems(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((invoice as any).lineItems ?? []).map((li: LineItemRow, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{li.description}</TableCell>
                        <TableCell className="text-right text-sm">{li.quantity}</TableCell>
                        <TableCell className="text-right text-sm">${li.unitPrice?.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">${(li.quantity * li.unitPrice)?.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t">
                      <td className="px-4 py-2" colSpan={3}><span className="font-semibold text-sm">Subtotal</span></td>
                      <td className="px-4 py-2 text-right font-semibold text-sm">${(invoice as any).subtotal?.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-1" colSpan={3}><span className="text-xs text-muted-foreground">Tax (8.5%)</span></td>
                      <td className="px-4 py-1 text-right text-xs text-muted-foreground">${(invoice as any).tax?.toFixed(2)}</td>
                    </tr>
                    <tr className="border-t-2">
                      <td className="px-4 py-2" colSpan={3}><span className="font-bold">Total</span></td>
                      <td className="px-4 py-2 text-right font-bold text-primary">${(invoice as any).total?.toFixed(2)}</td>
                    </tr>
                    {(Number((invoice as any).creditApplied ?? 0) > 0 || Number((invoice as any).depositApplied ?? 0) > 0) && (
                      <>
                        {Number((invoice as any).creditApplied ?? 0) > 0 && (
                        <tr>
                          <td className="px-4 py-1" colSpan={3}><span className="text-xs text-emerald-700">Prepaid credit applied</span></td>
                          <td className="px-4 py-1 text-right text-xs text-emerald-700" data-testid="text-credit-applied">-${Number((invoice as any).creditApplied).toFixed(2)}</td>
                        </tr>
                        )}
                        {Number((invoice as any).depositApplied ?? 0) > 0 && (
                        <tr>
                          <td className="px-4 py-1" colSpan={3}><span className="text-xs text-emerald-700">Deposit received</span></td>
                          <td className="px-4 py-1 text-right text-xs text-emerald-700" data-testid="text-deposit-applied">-${Number((invoice as any).depositApplied).toFixed(2)}</td>
                        </tr>
                        )}
                        <tr className="border-t">
                          <td className="px-4 py-2" colSpan={3}><span className="font-bold">Balance due</span></td>
                          <td className="px-4 py-2 text-right font-bold" data-testid="text-balance-due">${Number((invoice as any).balanceDue ?? (invoice as any).total).toFixed(2)}</td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </Table>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Notes</label>
                {!editingNotes && <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingNotes(true)}><Pencil className="w-3 h-3" /> Edit</Button>}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="min-h-[80px]" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveNotes} disabled={updateInvoice.isPending}>Save Notes</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{(invoice as any).notes || '—'}</p>
              )}
            </div>

            {/* Per-invoice terms & layout (draft only) */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Terms &amp; layout for this invoice</label>
                {(invoice as any).status !== 'draft' && <Badge variant="outline" className="text-[10px]">Locked after sending</Badge>}
              </div>
              {(invoice as any).status === 'draft' && canSend ? (
                <>
                  <Select value={layoutDraft} onValueChange={setLayoutDraft}>
                    <SelectTrigger className="h-8 w-48 text-xs" aria-label="Invoice layout"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clean">Clean layout</SelectItem>
                      <SelectItem value="detailed">Detailed layout</SelectItem>
                      <SelectItem value="compact">Compact layout</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea rows={3} value={termsDraft} onChange={e => setTermsDraft(e.target.value)} placeholder="Leave blank to print no terms on this invoice" aria-label="Invoice terms" />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleSaveWording} disabled={updateInvoice.isPending || (termsDraft === ((invoice as any).termsText ?? '') && layoutDraft === ((invoice as any).layout ?? 'clean'))}>Save terms &amp; layout</Button>
                    <span className="text-xs text-muted-foreground">Copied from the template when created. Editing here changes only this invoice.</span>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p className="capitalize">Layout: {(invoice as any).layout ?? 'clean'}</p>
                  <p className="whitespace-pre-wrap">{(invoice as any).termsText || 'No terms.'}</p>
                </div>
              )}
            </div>

            {/* Linked Job */}
            {job && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Linked Job</label>
                  <div className="rounded-lg border p-3 bg-muted/20 flex items-center gap-3">
                    <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{(job as any).label}</p>
                      {(job as any).scheduledAt && (
                        <p className="text-xs text-muted-foreground">{new Date((job as any).scheduledAt).toLocaleDateString()}</p>
                      )}
                    </div>
                    <Badge className={`${STATUS_COLORS[(job as any).status] ?? 'bg-muted text-muted-foreground'} border capitalize text-xs`}>
                      {(job as any).status}
                    </Badge>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {invoiceId != null && invoice && <div className="px-6 pb-6"><Separator className="my-4" /><DeliveryHistory type="invoice" id={invoiceId} /></div>}
      </SheetContent>
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record invoice payment</DialogTitle>
            <DialogDescription>Choose how the payment was received. Do not enter full card or bank details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem><SelectItem value="check">Check</SelectItem>
                  <SelectItem value="card">Card</SelectItem><SelectItem value="ach">ACH</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reference (optional)</label>
              <Input value={paymentReference} maxLength={200} onChange={e => setPaymentReference(e.target.value)} placeholder="Check number or receipt reference" />
            </div>
            {paymentMethod === 'card' && (
              <div className="grid grid-cols-2 gap-3">
                <Input value={paymentCardBrand} maxLength={50} onChange={e => setPaymentCardBrand(e.target.value)} placeholder="Card brand" />
                <Input value={paymentCardLast4} inputMode="numeric" maxLength={4} onChange={e => setPaymentCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Last 4 digits" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={!paymentMethod || markPaid.isPending || (paymentMethod === 'card' && !!paymentCardLast4 && paymentCardLast4.length !== 4)}>
              {markPaid.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Permanently delete invoice?</DialogTitle><DialogDescription>This cannot be undone. Paid or linked invoices will be blocked and should be archived instead.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteInvoice.isPending} onClick={() => invoiceId && deleteInvoice.mutate({ id: invoiceId, data: { confirm: true } }, {
              onSuccess: () => { toast.success('Invoice deleted'); setDeleteDialogOpen(false); invalidateInvoice(); onClose(); },
              onError: (err: any) => toast.error(err?.response?.data?.error ?? err?.message ?? 'Invoice cannot be deleted'),
            })}>{deleteInvoice.isPending ? 'Deleting…' : 'Permanently delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={chargeConfirmOpen} onOpenChange={o => { if (!chargeCard.isPending) setChargeConfirmOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Charge saved card</DialogTitle>
            <DialogDescription>
              Charge ${Number((invoice as any)?.balanceDue ?? (invoice as any)?.total ?? 0).toFixed(2)} to the customer's saved card for invoice {(invoice as any)?.invoiceNumber ?? ''}. The invoice is only marked paid if the payment provider confirms the charge.
            </DialogDescription>
          </DialogHeader>
          {chargeResult && (
            <div data-testid="status-charge-result" className={`rounded-md border p-3 text-sm ${chargeResult.status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : chargeResult.status === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              <p className="font-semibold capitalize">{chargeResult.status}</p>
              <p>{chargeResult.message}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeConfirmOpen(false)} disabled={chargeCard.isPending}>{chargeResult ? 'Close' : 'Cancel'}</Button>
            {!chargeResult && (
              <Button onClick={handleChargeCard} disabled={chargeCard.isPending} data-testid="button-confirm-charge">
                {chargeCard.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Charging…</> : 'Charge now'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const [, setLocation] = useLocation();
  const routeSearch = useSearch();
  const qc = useQueryClient();
  const { user, canManageOffice } = useAuth();

  // State
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(() => (initialTab && initialTab !== 'invoice-templates' && initialTab !== 'vendors' ? initialTab : 'invoices'));
  const [invoiceTemplatesOpen, setInvoiceTemplatesOpen] = useState(initialTab === 'invoice-templates');
  // Vendor expenses moved to their own page; keep old deep links working.
  useEffect(() => { if (initialTab === 'vendors') setLocation('/vendors'); }, [initialTab, setLocation]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchivedInvoices, setShowArchivedInvoices] = useState(false);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);
  const [autoOpenSendForId, setAutoOpenSendForId] = useState<number | null>(null);
  // Deep link support: /invoices?invoiceId=123 opens that invoice's detail sheet.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('invoiceId');
    const n = raw ? Number(raw) : NaN;
    if (Number.isInteger(n) && n > 0) setEditInvoiceId(n);
  }, []);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringInvoiceTemplate | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<{ id: number; name: string } | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<RecurringInvoiceTemplate | null>(null);
  const [stopFlagFilter, setStopFlagFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [cancelFilter, setCancelFilter] = useState<'all' | 'pending' | 'approved'>('all');

  // Queries
  // Keep one canonical cache containing both lifecycle states; the table below
  // selects active vs archived rows locally so archive/restore cannot expose a
  // stale list from a different query key.
  const invoiceParams = { includeArchived: true };
  const { data: invoices, isLoading: invoicesLoading } = useListInvoices(invoiceParams, { query: { queryKey: getListInvoicesQueryKey(invoiceParams) } });
  const { data: summary } = useGetFinancialsSummary({ query: { queryKey: getGetFinancialsSummaryQueryKey() } });
  const { data: templates } = useListRecurringTemplates({ query: { queryKey: getListRecurringTemplatesQueryKey() } });
  const { data: automationStatus } = useGetBillingAutomationStatus({ query: { queryKey: getGetBillingAutomationStatusQueryKey() } });
  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey() } });
  const { data: stopFlags } = useListStopServiceFlags(undefined, { query: { queryKey: getListStopServiceFlagsQueryKey() } });
  const { data: cancelRequests } = useListPlanCancelRequests(undefined, { query: { queryKey: getListPlanCancelRequestsQueryKey() } });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  const runNow = useRunRecurringTemplateNow();
  const deleteTemplate = useDeleteRecurringTemplate();
  const approveStop = useApproveStopServiceFlag();
  const dismissStop = useDismissStopServiceFlag();
  const resumeStop = useResumeStopServiceFlagPlan();
  const approveCancelReq = useApprovePlanCancelRequest();
  const dismissCancelReq = useDismissPlanCancelRequest();

  const customerOptions = (customers?.items ?? []).map(c => ({ id: c.id, name: c.name }));

  // Handle ?action=create&customerId= from other pages
  useEffect(() => {
    const params = new URLSearchParams(routeSearch);
    if (params.get('action') === 'create') {
      setTab('invoices');
      setCreateInvoiceOpen(true);
      const cid = params.get('customerId');
      if (cid) {
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent('financials:prefillCustomer', { detail: cid }));
        }, 100);
      }
      setLocation(window.location.pathname, { replace: true });
    }
  }, [routeSearch, setLocation]);

  const handleRunNow = (templateId: number, excludeJobIds: number[]) => {
    runNow.mutate({ id: templateId, data: { excludeJobIds } as any }, {
      onSuccess: (data: any) => {
        toast.success(`Generated ${data?.generatedCount ?? 0} invoice${(data?.generatedCount ?? 0) !== 1 ? 's' : ''}`);
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFinancialsSummaryQueryKey() });
        setPreviewTemplate(null);
      },
      onError: () => toast.error('Failed to generate invoices'),
    });
  };

  const filteredInvoices = (invoices ?? []).filter(inv => {
    if (showArchivedInvoices ? !(inv as any).archivedAt : !!(inv as any).archivedAt) return false;
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const invAny = inv as any;
      return (
        (invAny.invoiceNumber ?? '').toLowerCase().includes(q) ||
        (invAny.customerName ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingStopFlags = (stopFlags ?? []).filter((f: StopServiceFlag) => f.status === 'pending');
  const pendingCancelRequests = (cancelRequests ?? []).filter((r: PlanCancelRequest) => r.status === 'pending');

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Sheet open={invoiceTemplatesOpen} onOpenChange={setInvoiceTemplatesOpen}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Invoice Templates</SheetTitle>
            <SheetDescription>Layouts, terms and late fees applied when an invoice is created from a template. Invoices already issued keep their wording.</SheetDescription>
          </SheetHeader>
          <InvoiceTemplatesSettings />
        </SheetContent>
      </Sheet>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground mt-1">Bill customers, collect payments, and track revenue.{(invoices ?? []).length > 0 ? ` · ${(invoices ?? []).length} total` : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setInvoiceTemplatesOpen(true)} data-testid="button-invoice-templates">Invoice Templates</Button>
          <div className="flex rounded-md border p-0.5" aria-label="Invoice lifecycle view">
            <Button size="sm" variant={!showArchivedInvoices ? 'default' : 'ghost'} onClick={() => setShowArchivedInvoices(false)}>Active Invoices</Button>
            <Button size="sm" variant={showArchivedInvoices ? 'default' : 'ghost'} onClick={() => setShowArchivedInvoices(true)}>Archived History</Button>
          </div>
          <ImportExportControls
            entity="invoices"
            entityLabel="Invoices"
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() })}
          />
          <Button className="gap-2" title="Create a new invoice" onClick={() => setCreateInvoiceOpen(true)}><Plus className="w-4 h-4" /> New Invoice</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
        {(() => {
          const draftInvoices = (invoices ?? []).filter(inv => inv.status === 'draft');
          const draftTotal = draftInvoices.reduce((s, inv) => s + inv.total, 0);
          const activeStaticTemplates = (templates ?? []).filter((t: any) => t.isActive && t.billingMode !== 'completed_work');
          const mrrValue = activeStaticTemplates.reduce((sum: number, t: any) => {
            const li: { quantity: number; unitPrice: number }[] = Array.isArray(t.lineItems) ? t.lineItems : [];
            const subtotal = li.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
            if (t.billingCycleType === 'daily') return sum + subtotal * 30;
            if (t.billingCycleType === 'weekly' || t.cycle === 'weekly') return sum + subtotal * 4;
            if (t.billingCycleType === 'bi_monthly') return sum + subtotal * 2;
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
          ] as { label: string; value?: number; icon: React.ElementType; color: string; destructive?: boolean }[];
        })().map(({ label, value, icon: Icon, color, destructive }) => (
          <Card key={label} className={destructive && (value ?? 0) > 0 ? 'border-destructive/40' : ''}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">${((value ?? 0) / 1).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alerts */}
      {pendingStopFlags.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 font-medium">
              {pendingStopFlags.length} stop-service flag{pendingStopFlags.length !== 1 ? 's' : ''} pending review — <button className="underline" onClick={() => setTab('flags')}>review now</button>
            </p>
          </CardContent>
        </Card>
      )}

      <BillingEmailDeliveries />
      {/* Automation status */}
      {(automationStatus as any)?.lastRunAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3" />
          Last billing run: {new Date((automationStatus as any).lastRunAt).toLocaleString()}
          {(automationStatus as any).generatedCount != null && <> · Generated {(automationStatus as any).generatedCount} invoice{(automationStatus as any).generatedCount !== 1 ? 's' : ''}</>}
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">Invoices {(invoices ?? []).length > 0 ? `(${(invoices ?? []).length})` : ''}</TabsTrigger>
          <TabsTrigger value="recurring">Recurring Templates {(templates ?? []).length > 0 ? `(${(templates ?? []).length})` : ''}</TabsTrigger>
          {pendingStopFlags.length > 0 && (
            <TabsTrigger value="flags">
              Stop-Service Flags
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{pendingStopFlags.length}</Badge>
            </TabsTrigger>
          )}
          {pendingCancelRequests.length > 0 && (
            <TabsTrigger value="cancels">
              Cancel Requests
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{pendingCancelRequests.length}</Badge>
            </TabsTrigger>
          )}
        </TabsList>


        {/* Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4 focus-visible:outline-none">
          <BillingCoveragePanel enabled={!!canManageOffice} />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input title="Search invoices by customer name or invoice number" placeholder="Search invoices…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-36" title="Filter by invoice status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filteredInvoices.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
                  ) : filteredInvoices.map(inv => {
                    const invAny = inv as any;
                    return (
                      <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEditInvoiceId(inv.id)}>
                        <TableCell className="font-mono text-xs">{invAny.invoiceNumber}</TableCell>
                        <TableCell>
                          <div className="font-medium">{invAny.customerName ?? '—'}</div>
                          {invAny.propertyAddress && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />{invAny.propertyAddress}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${STATUS_COLORS[inv.status] ?? ''} border text-xs capitalize`}>{inv.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invAny.invoiceDate ? new Date(invAny.invoiceDate).toLocaleDateString() : invAny.createdAt ? new Date(invAny.createdAt).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invAny.dueDate ? new Date(invAny.dueDate).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ${inv.total.toFixed(2)}
                          {(Number(invAny.creditApplied ?? 0) > 0 || Number(invAny.depositApplied ?? 0) > 0) && (
                            <div className="text-[11px] font-normal text-emerald-700">due ${Number(invAny.balanceDue ?? inv.total).toFixed(2)}</div>
                          )}
                        </TableCell>
                        <TableCell className="w-8">
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recurring Templates Tab */}
        <TabsContent value="recurring" className="space-y-4 focus-visible:outline-none">
          <div className="flex justify-end">
            <Button className="gap-2" size="sm" onClick={() => { setEditingTemplate(null); setTemplateSheetOpen(true); }}>
              <Plus className="w-4 h-4" /> New Template
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template / Scope</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(templates ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No recurring templates. <button className="text-primary hover:underline" onClick={() => setTemplateSheetOpen(true)}>Create one →</button></TableCell></TableRow>
                  ) : (templates ?? []).map((t: any) => {
                    const li: { quantity: number; unitPrice: number }[] = Array.isArray(t.lineItems) ? t.lineItems : [];
                    const subtotal = li.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
                    return (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell>
                          <div className="font-medium">{t.name}</div>
                          <div className="text-xs text-muted-foreground">{t.customerId ? (t.customerName ?? customerOptions.find(c => c.id === t.customerId)?.name ?? `Customer #${t.customerId}`) : 'All customers'} · {t.serviceId ? (t.serviceName ?? 'Service') : 'All services'}</div>
                        </TableCell>
                        <TableCell className="text-sm">{({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', bi_monthly: 'Twice a month' } as Record<string, string>)[t.billingCycleType] ?? t.billingCycleType ?? t.cycle}</TableCell>
                        <TableCell className="capitalize text-sm">{t.billingMode === 'completed_work' ? 'Completed Work' : 'Fixed'}</TableCell>
                        <TableCell>
                          <Badge variant={t.isActive ? 'default' : 'secondary'} className="capitalize text-xs">{t.isActive ? 'Active' : 'Paused'}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">${subtotal.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Preview billable jobs" onClick={() => setPreviewTemplate(t)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit template" onClick={() => { setEditingTemplate(t); setTemplateSheetOpen(true); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete template" onClick={() => setDeleteTemplateId({ id: t.id, name: t.notes || `Template #${t.id}` })}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stop-Service Flags Tab */}
        {pendingStopFlags.length > 0 && (
          <TabsContent value="flags" className="space-y-4 focus-visible:outline-none">
            <div className="flex items-center gap-2">
              {(['all', 'pending', 'approved'] as const).map(f => (
                <Button key={f} variant={stopFlagFilter === f ? 'default' : 'outline'} size="sm" className="capitalize" onClick={() => setStopFlagFilter(f)}>{f}</Button>
              ))}
            </div>
            <div className="space-y-3">
              {(stopFlags ?? [])
                .filter((f: StopServiceFlag) => stopFlagFilter === 'all' || f.status === stopFlagFilter)
                .map((flag: StopServiceFlag) => (
                  <Card key={flag.id} className={flag.status === 'pending' ? 'border-amber-200' : ''}>
                    <CardContent className="p-4 flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{(flag as any).customerName ?? `Customer #${flag.customerId}`}</p>
                          <Badge variant={flag.status === 'pending' ? 'outline' : 'secondary'} className="capitalize text-xs">{flag.status}</Badge>
                        </div>
                        {(flag as any).reason && <p className="text-xs text-muted-foreground">{(flag as any).reason}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(flag.createdAt).toLocaleDateString()}</p>
                      </div>
                      {flag.status === 'pending' && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                            onClick={() => approveStop.mutate({ id: flag.id }, { onSuccess: () => { toast.success('Flag approved'); qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey() }); } })}>
                            <Check className="w-3.5 h-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                            onClick={() => resumeStop.mutate({ id: flag.id }, { onSuccess: () => { toast.success('Service resumed'); qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey() }); } })}>
                            <Play className="w-3.5 h-3.5" /> Resume
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive"
                            onClick={() => dismissStop.mutate({ id: flag.id }, { onSuccess: () => { toast.success('Flag dismissed'); qc.invalidateQueries({ queryKey: getListStopServiceFlagsQueryKey() }); } })}>
                            <X className="w-3.5 h-3.5" /> Dismiss
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </TabsContent>
        )}

        {/* Cancel Requests Tab */}
        {pendingCancelRequests.length > 0 && (
          <TabsContent value="cancels" className="space-y-4 focus-visible:outline-none">
            <div className="flex items-center gap-2">
              {(['all', 'pending', 'approved'] as const).map(f => (
                <Button key={f} variant={cancelFilter === f ? 'default' : 'outline'} size="sm" className="capitalize" onClick={() => setCancelFilter(f)}>{f}</Button>
              ))}
            </div>
            <div className="space-y-3">
              {(cancelRequests ?? [])
                .filter((r: PlanCancelRequest) => cancelFilter === 'all' || r.status === cancelFilter)
                .map((req: PlanCancelRequest) => (
                  <Card key={req.id} className={req.status === 'pending' ? 'border-amber-200' : ''}>
                    <CardContent className="p-4 flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{(req as any).customerName ?? `Customer #${req.customerId}`}</p>
                          <Badge variant={req.status === 'pending' ? 'outline' : 'secondary'} className="capitalize text-xs">{req.status}</Badge>
                        </div>
                        {(req as any).reason && <p className="text-xs text-muted-foreground">{(req as any).reason}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(req.createdAt).toLocaleDateString()}</p>
                      </div>
                      {req.status === 'pending' && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                            onClick={() => approveCancelReq.mutate({ id: req.id }, { onSuccess: () => { toast.success('Request approved'); qc.invalidateQueries({ queryKey: getListPlanCancelRequestsQueryKey() }); } })}>
                            <Check className="w-3.5 h-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive"
                            onClick={() => dismissCancelReq.mutate({ id: req.id }, { onSuccess: () => { toast.success('Request dismissed'); qc.invalidateQueries({ queryKey: getListPlanCancelRequestsQueryKey() }); } })}>
                            <X className="w-3.5 h-3.5" /> Dismiss
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </TabsContent>
        )}

        {/* Vendor Expenses Tab */}
      </Tabs>

      {/* Sheets & Dialogs */}
      <EditInvoiceSheet
        invoiceId={editInvoiceId ?? autoOpenSendForId}
        onClose={() => { setEditInvoiceId(null); setAutoOpenSendForId(null); }}
        onRestored={() => setShowArchivedInvoices(false)}
        autoOpenSend={autoOpenSendForId != null && editInvoiceId == null}
      />

      <RecurringTemplateSheet
        open={templateSheetOpen}
        onClose={() => { setTemplateSheetOpen(false); setEditingTemplate(null); }}
        editing={editingTemplate}
        customers={customerOptions}
      />

      <CreateInvoiceSheet
        open={createInvoiceOpen}
        onClose={() => setCreateInvoiceOpen(false)}
        customers={customerOptions}
        invoiceDueDays={(settings as any)?.invoiceDueDays}
        onSaveAndSend={(id) => { setCreateInvoiceOpen(false); setAutoOpenSendForId(id); }}
      />

      <PreviewBillingDialog
        templateId={previewTemplate?.id ?? null}
        templateName={previewTemplate?.name ?? null}
        onClose={() => setPreviewTemplate(null)}
        onGenerate={(excludeJobIds) => { if (previewTemplate) handleRunNow(previewTemplate.id, excludeJobIds); }}
        isGenerating={runNow.isPending}
      />

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
              title="Permanently delete this recurring template"
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
              disabled={deleteTemplate.isPending}
            >
              {deleteTemplate.isPending ? 'Deleting…' : 'Delete Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
